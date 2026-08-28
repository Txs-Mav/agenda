/**
 * Le modèle « item » unifié — étape 3 de la feuille de route.
 *
 * Un seul enregistrement pour tout ce qui est collecté, quelle que soit la
 * source. Un adaptateur par source, et c'est le SEUL endroit qui connaît la
 * forme d'origine : au-delà, l'agenda ne manipule plus que des items.
 *
 * La règle qui tient l'ensemble, et qu'aucun adaptateur n'a le droit
 * d'enfreindre : un item est un FAIT. Il ne porte ni « fait », ni « vu », ni
 * « supprimé ». Tout ça vit dans agenda_item_etat, que la collecte n'écrit
 * jamais. C'est pour ça qu'une collecte peut réécrire tous les items sans
 * rien détruire — et que sept mécanismes du client (gone, mods, acted,
 * prunGone, memeTitre, dupEcheance, actionSupprimee) deviennent inutiles.
 */
import type { Deadline, Mio } from "../store.js";

export type Source = "lea" | "mio" | "moodle" | "manuel" | "classe";
export type Genre =
  | "message" | "document" | "devoir" | "examen" | "tache" | "seance" | "autre";

export type Item = {
  /** « source:clé naturelle » — le même devoir donne le même id à chaque passage. */
  id: string;
  source: Source;
  genre: Genre;
  cours?: string;
  code_cours?: string;
  moodle_course_id?: number;
  titre: string;
  resume?: string;
  consigne?: string;
  /** Le lien profond vers la source, jamais une page d'accueil. */
  url?: string;
  publie_le?: string;      // ISO 8601
  echeance_le?: string;    // ISO 8601
  /** Une date sans heure connue : le rappel part le matin, pas « dans 1 h ». */
  jour_seul?: boolean;
  /** Ce que la source disait, brut : de quoi rejouer un adaptateur corrigé. */
  charge?: unknown;
};

const vide = (s: string | undefined | null) => (s ?? "").trim() || undefined;

/**
 * Date + heure locales vers un instant. L'agenda travaille en heure locale
 * (« remis le 12 à 23 h 59 » veut dire 23 h 59 ici, pas UTC) : on construit
 * donc la date dans le fuseau de la machine et on la sérialise ensuite.
 */
function instant(date: string, time?: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return undefined;
  const [a = 0, m = 1, j = 1] = date.split("-").map(Number);
  const [h = 0, mn = 0] = (time && /^\d{1,2}:\d{2}$/.test(time) ? time : "00:00")
    .split(":").map(Number);
  const d = new Date(a, m - 1, j, h, mn, 0, 0);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const GENRE_ECHEANCE: Record<Deadline["kind"], Genre> = {
  examen: "examen",
  remise: "devoir",
  autre: "autre",
};

/**
 * Une échéance déjà collectée (Léa, Moodle, MIO, saisie) devient un item.
 *
 * L'id garde le préfixe de sa source pour rester unique entre sources, et
 * réutilise l'identifiant existant : les états déjà posés par l'étudiant
 * continuent de coller à leur item.
 *
 * Réserve assumée : côté Léa, cet identifiant est un hachage de
 * « sigle + titre + date » (voir parseCard). Il n'est donc PAS stable quand
 * le prof déplace une remise — l'ancienne date fabrique un autre id. Moodle
 * n'a pas ce défaut (`assignid` est une vraie clé). Le rapprochement des
 * deux, quand un même devoir arrive par les deux voies, est une étape de
 * fusion à écrire ici, pas une ressemblance de titres au moment d'afficher.
 */
export function itemDEcheance(d: Deadline): Item {
  return {
    id: `${d.src}:${d.id}`,
    source: d.src,
    genre: GENRE_ECHEANCE[d.kind] ?? "autre",
    cours: vide(d.course),
    code_cours: vide(d.code),
    titre: d.t,
    url: vide(d.url),
    echeance_le: instant(d.date, d.time),
    jour_seul: !d.time,
    charge: d,
  };
}

/** Un MIO devient un item « message » : il n'a pas d'échéance, il en annonce. */
export function itemDeMio(m: Mio): Item {
  return {
    id: `mio:${m.id}`,
    source: "mio",
    genre: "message",
    cours: vide(m.course),
    titre: vide(m.subject) ?? "Message sans objet",
    resume: vide(m.summary),
    publie_le: instant(m.date),
    charge: m,
  };
}

/**
 * Un document publié par un prof (Moodle « nouveautés »). Il n'a pas
 * d'échéance non plus — c'est une chose à aller lire, avec son URL exacte.
 */
export type DocMoodle = {
  cle: string; titre: string; cours?: string; sigle?: string;
  url?: string; quand?: string; moodleCourseId?: number;
};
export function itemDeDocument(d: DocMoodle): Item {
  return {
    id: `moodle:doc:${d.cle}`,
    source: "moodle",
    genre: "document",
    cours: vide(d.cours),
    code_cours: vide(d.sigle),
    moodle_course_id: d.moodleCourseId,
    titre: d.titre,
    url: vide(d.url),
    publie_le: d.quand,
    charge: d,
  };
}

/**
 * Deux sources peuvent annoncer le même devoir — Léa le liste, Moodle le
 * porte. On garde celui qui a l'URL exacte (Moodle), en lui laissant l'état
 * déjà posé sur l'autre : c'est une FUSION, décidée à l'ingestion, jamais un
 * doublon qu'on masquerait à l'affichage.
 *
 * Le rapprochement reste volontairement prudent : même sigle de cours, même
 * jour, et des titres qui se contiennent l'un l'autre une fois normalisés.
 * Dans le doute, on garde les deux — deux lignes visibles valent mieux
 * qu'une remise disparue.
 */
const norm = (s?: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

export function fusionne(items: Item[]): Item[] {
  const rang: Record<Source, number> = { moodle: 0, lea: 1, mio: 2, manuel: 3, classe: 4 };
  const gardes: Item[] = [];
  for (const it of [...items].sort((a, b) => rang[a.source] - rang[b.source])) {
    if (!it.echeance_le) { gardes.push(it); continue; }
    const jour = it.echeance_le.slice(0, 10);
    const t = norm(it.titre);
    const jumeau = gardes.find((g) =>
      g.echeance_le?.slice(0, 10) === jour &&
      norm(g.code_cours) === norm(it.code_cours) &&
      norm(g.code_cours) !== "" &&
      (norm(g.titre).includes(t) || t.includes(norm(g.titre))));
    if (jumeau) continue;   // déjà porté par une source mieux placée
    gardes.push(it);
  }
  return gardes;
}
