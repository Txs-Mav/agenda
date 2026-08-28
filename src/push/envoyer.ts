/**
 * Émetteur de notifications push — le demi-serveur qui manquait à la PWA.
 *
 *   npm run push -- "Titre" "Corps de la notification" [/chemin-a-ouvrir]
 *
 * Envoie à TOUS les navigateurs où le compte d'agenda a activé les rappels
 * (table agenda_push_subs, une ligne par appareil installé). Même pont que la
 * synchronisation : le compte d'agenda du .env, jamais de clé serveur. La
 * collecte peut appeler envoyerPush() quand elle rapporte du neuf — c'est le
 * point d'accroche prévu.
 *
 * La clé VAPID publique vit aussi en dur dans agenda.html et public/sw.js ;
 * si la paire change, ces deux copies doivent suivre, et chaque appareil
 * devra se réabonner (éteindre puis rallumer les rappels).
 */
import "../config.js";   // effet de bord : charge le .env (clés VAPID, compte)
import webpush from "web-push";
import { sessionAgenda } from "../sync/supabase.js";
import { log } from "../log.js";

const URL_ = process.env.SUPABASE_URL || "https://olkbhrbyubejetqygdcy.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X";

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

function vapidPret(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    log.error("Clés VAPID absentes du .env — npx web-push generate-vapid-keys, puis remplis VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY.");
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:mavmenard@gmail.com", pub, priv);
  return true;
}

/** Envoie une notification à tous les appareils abonnés du compte. Rend le
 *  compte d'envois réussis. Ne lève jamais : une alerte qui casse son
 *  appelant serait pire que pas d'alerte. */
export async function envoyerPush(titre: string, corps = "", url = "/"): Promise<number> {
  if (!vapidPret()) return 0;
  const s = await sessionAgenda();
  if (!s) { log.warn("Pas de compte d'agenda dans le .env — personne à prévenir."); return 0; }
  const entetes = { apikey: KEY, authorization: `Bearer ${s.token}`, "content-type": "application/json" };

  let subs: Sub[] = [];
  try {
    const r = await fetch(`${URL_}/rest/v1/agenda_push_subs?select=id,endpoint,p256dh,auth`, { headers: entetes });
    if (!r.ok) { log.warn(`Lecture des abonnements refusée (${r.status}).`); return 0; }
    subs = (await r.json()) as Sub[];
  } catch (err) {
    log.warn(`Supabase inaccessible : ${err instanceof Error ? err.message : err}`);
    return 0;
  }
  if (!subs.length) { log.info("Aucun appareil abonné — active les rappels dans l'app installée."); return 0; }

  const charge = JSON.stringify({ title: titre, body: corps, url, tag: "agenda-push" });
  let ok = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        charge,
        { TTL: 3600 },
      );
      ok++;
      await fetch(`${URL_}/rest/v1/agenda_push_subs?id=eq.${sub.id}`, {
        method: "PATCH", headers: entetes, body: JSON.stringify({ last_ok: new Date().toISOString() }),
      }).catch(() => {});
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      /* 404/410 : l'abonnement est mort (app désinstallée, permission retirée).
         On efface la ligne — la garder ferait échouer chaque envoi suivant. */
      if (code === 404 || code === 410) {
        await fetch(`${URL_}/rest/v1/agenda_push_subs?id=eq.${sub.id}`, { method: "DELETE", headers: entetes })
          .catch(() => {});
        log.info("Un abonnement mort a été retiré.");
      } else {
        log.warn(`Envoi refusé (${code ?? "?"}) : ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  log.info(`Push envoyé à ${ok}/${subs.length} appareil${subs.length > 1 ? "s" : ""}.`);
  return ok;
}

/* Lancé directement (npm run push) : les arguments font la notification. */
if (process.argv[1]?.endsWith("envoyer.ts")) {
  const [titre, corps, url] = process.argv.slice(2);
  if (!titre) {
    log.error('Usage : npm run push -- "Titre" ["Corps"] [/chemin]');
    process.exit(2);
  }
  const n = await envoyerPush(titre, corps ?? "", url ?? "/");
  process.exit(n > 0 ? 0 : 1);
}
