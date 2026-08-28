/**
 * Dépose le jeton Moodle local dans le compte d'agenda, pour que la collecte
 * passe côté serveur.
 *
 *   npm run moodle-apparier
 *
 * Pourquoi une commande séparée, et pourquoi elle ne tourne qu'une fois :
 * le flux mobile de Moodle redirige vers un schéma d'URL personnalisé
 * (`moodlemobile://token=…`) qu'une app web ne peut pas capter sur iOS. Un
 * iPad ne peut donc PAS obtenir son jeton lui-même. Il l'obtient par cet
 * appariement, fait une fois depuis n'importe quel ordinateur — après quoi
 * l'iPad n'a plus jamais besoin de rien : le serveur collecte, l'appareil lit.
 *
 * Ce qui monte : le jeton de service web (durable, lecture seule). Ce qui ne
 * monte JAMAIS : le mot de passe M365, que ce projet ne lit pas et ne stocke
 * pas — la doctrine d'Omnivox vaut ici aussi.
 *
 * Une fois déposé, le jeton ne redescend pas : la colonne est retirée de la
 * lecture pour `authenticated`. On peut le remplacer, le retirer, savoir
 * quand il a servi — pas le relire.
 */
import { lireJeton, MOODLE_HOST } from "./api.js";
import { sessionAgenda } from "../sync/supabase.js";
import { log } from "../log.js";

const URL_ = process.env.SUPABASE_URL || "https://olkbhrbyubejetqygdcy.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X";

export async function apparier(): Promise<void> {
  const j = lireJeton();
  if (!j) {
    log.error("Aucun jeton Moodle sur cette machine. Fais d'abord : npm run moodle-login");
    process.exit(2);
  }
  const s = await sessionAgenda();
  if (!s) {
    log.error("Aucun compte d'agenda dans le .env (AGENDA_EMAIL / AGENDA_PASSWORD).");
    log.error("C'est ce compte qui portera la collecte serveur — sans lui, rien à apparier.");
    process.exit(2);
  }

  const r = await fetch(`${URL_}/rest/v1/agenda_moodle_jetons?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: KEY,
      authorization: `Bearer ${s.token}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([{
      user_id: s.uid,
      site: j.host || MOODLE_HOST,
      jeton: j.token,
      erreur: null,
    }]),
  });
  if (!r.ok) {
    log.error(`Dépôt refusé (${r.status}) — ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  log.info(`Jeton Moodle déposé pour ${s.email} (site ${j.host || MOODLE_HOST}).`);
  log.info("La collecte serveur peut maintenant tourner sans qu'aucun appareil soit allumé.");
  log.info("Tes autres appareils — iPad compris — verront les remises sans rien installer.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  apparier().catch((e) => { log.error(String(e)); process.exit(1); });
}
