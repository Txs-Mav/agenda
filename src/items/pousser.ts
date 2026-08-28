/**
 * Pousse les items collectés vers `agenda_items`.
 *
 * Le contrat, en une phrase : **on écrit les faits, on ne touche jamais au
 * calque**. Pas de lecture préalable des suppressions, pas de filtrage : un
 * item retiré par l'étudiant est réécrit ici sans état d'âme, et c'est la vue
 * `agenda_vue_items` qui l'exclut, parce que son statut « supprime » vit dans
 * `agenda_item_etat` que personne d'autre que lui n'écrit.
 *
 * C'est exactement ce qui disparaît du client : la collecte n'a plus à savoir
 * ce que l'étudiant a fait, donc plus rien à ménager.
 */
import { sessionAgenda } from "../sync/supabase.js";
import { log } from "../log.js";
import type { Item } from "./modele.js";

const URL_ = process.env.SUPABASE_URL || "https://olkbhrbyubejetqygdcy.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X";

/** Au-delà, PostgREST commence à peiner et une coupure perd tout le lot. */
const LOT = 200;

/**
 * Rend le nombre d'items écrits. Ne lève jamais : une collecte qui casse
 * parce que le nuage boude serait pire que pas de nuage — le fichier local
 * reste la copie de travail.
 */
export async function pousserItems(items: Item[]): Promise<number> {
  if (!items.length) return 0;
  const s = await sessionAgenda();
  if (!s) return 0;   // pur local, rien à faire — et rien à dire

  const entetes = {
    apikey: KEY,
    authorization: `Bearer ${s.token}`,
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates",
  };

  let ecrits = 0;
  for (let i = 0; i < items.length; i += LOT) {
    const lot = items.slice(i, i + LOT).map((it) => ({
      user_id: s.uid,
      id: it.id,
      source: it.source,
      genre: it.genre,
      cours: it.cours ?? null,
      code_cours: it.code_cours ?? null,
      moodle_course_id: it.moodle_course_id ?? null,
      titre: it.titre,
      resume: it.resume ?? null,
      consigne: it.consigne ?? null,
      url: it.url ?? null,
      publie_le: it.publie_le ?? null,
      echeance_le: it.echeance_le ?? null,
      jour_seul: it.jour_seul ?? false,
      charge: it.charge ?? null,
      collecte_le: new Date().toISOString(),
    }));
    try {
      const r = await fetch(`${URL_}/rest/v1/agenda_items?on_conflict=user_id,id`, {
        method: "POST", headers: entetes, body: JSON.stringify(lot),
      });
      if (!r.ok) {
        log.warn(`agenda_items : écriture refusée (${r.status}) — ${(await r.text()).slice(0, 160)}`);
        return ecrits;
      }
      ecrits += lot.length;
    } catch (err) {
      log.warn(`Supabase inaccessible : ${err instanceof Error ? err.message : err}`);
      return ecrits;
    }
  }
  log.info(`${ecrits} item${ecrits > 1 ? "s" : ""} poussé${ecrits > 1 ? "s" : ""} vers agenda_items`);
  return ecrits;
}
