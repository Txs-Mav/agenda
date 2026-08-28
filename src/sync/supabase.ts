import { log } from "../log.js";
import { registerSecret } from "../redact.js";

/**
 * Pont avec le compte d'agenda de L'UTILISATEUR (courriel + mot de passe
 * d'agenda, PAS les identifiants Omnivox — ceux-là ne quittent jamais la
 * machine) : on y pousse le snapshot dérivé et on y relit ce que l'utilisateur
 * a supprimé à la main.
 *
 * RLS côté base : chacun ne peut écrire et lire que ses propres lignes.
 * Entièrement facultatif : sans les variables, on saute en silence.
 */
const URL_ = process.env.SUPABASE_URL || "https://olkbhrbyubejetqygdcy.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X";

type Sess = { token: string; uid: string; email: string };
/** undefined = pas encore tenté ; null = pas de compte configuré, ou refus. */
let sess: Sess | null | undefined;

/** Ouvre la session UNE fois par exécution : la collecte y touche deux fois. */
/** Le pont sert aussi à l'émetteur de push : même compte, même session. */
export async function sessionAgenda(): Promise<Sess | null> { return session(); }

async function session(): Promise<Sess | null> {
  if (sess !== undefined) return sess;
  sess = null;
  const email = process.env.AGENDA_EMAIL, pass = process.env.AGENDA_PASSWORD;
  if (!email || !pass) return sess; // pas de compte configuré : pur local, rien à faire
  registerSecret(pass);
  try {
    const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password: pass }),
    });
    if (!auth.ok) {
      log.warn(`Supabase : connexion refusée (${auth.status}) — on reste en local.`);
      return sess;
    }
    const { access_token, user } = (await auth.json()) as { access_token: string; user: { id: string } };
    registerSecret(access_token);
    sess = { token: access_token, uid: user.id, email };
  } catch (err) {
    log.warn(`Supabase inaccessible : ${err instanceof Error ? err.message : err}`);
  }
  return sess;
}

const masque = (email: string) => email.replace(/(.).+(@.+)/, "$1***$2");

export async function pushSnapshot(payload: unknown, kind: "export" | "horaire" = "export"): Promise<void> {
  const s = await session();
  if (!s) return;
  try {
    const up = await fetch(`${URL_}/rest/v1/agenda_snapshots`, {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: `Bearer ${s.token}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([{ user_id: s.uid, kind, payload }]),
    });
    if (!up.ok) {
      log.warn(`Supabase : écriture refusée (${up.status}) — ${(await up.text()).slice(0, 120)}`);
      return;
    }
    log.info(`snapshot « ${kind} » poussé vers Supabase (compte ${masque(s.email)})`);
  } catch (err) {
    log.warn(`Supabase inaccessible : ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Ce que l'utilisateur a supprimé dans l'interface, par identifiant. L'agenda
 * consigne chaque suppression sous le genre « suppressions » ; la collecte la
 * relit AVANT d'écrire, sinon elle repousserait à chaque passage l'échéance
 * Léa qui vient d'être retirée — Omnivox, lui, l'affiche toujours.
 *
 * Aucun compte, pas de réseau, ligne absente : ensemble vide, et la collecte
 * se comporte comme avant. L'interface filtre de son côté de toute façon.
 */
export async function fetchSuppressions(): Promise<Set<string>> {
  const s = await session();
  if (!s) return new Set();
  try {
    const r = await fetch(`${URL_}/rest/v1/agenda_snapshots?kind=eq.suppressions&select=payload`, {
      headers: { apikey: KEY, authorization: `Bearer ${s.token}` },
    });
    if (!r.ok) {
      log.warn(`Supabase : suppressions illisibles (${r.status}) — rien n'est filtré ce passage.`);
      return new Set();
    }
    const rows = (await r.json()) as { payload?: { gone?: Record<string, unknown> } }[];
    const ids = Object.keys(rows[0]?.payload?.gone ?? {});
    if (ids.length) log.info(`${ids.length} élément(s) supprimé(s) par toi — ils ne seront pas repoussés`);
    return new Set(ids);
  } catch (err) {
    log.warn(`Supabase inaccessible : ${err instanceof Error ? err.message : err}`);
    return new Set();
  }
}
