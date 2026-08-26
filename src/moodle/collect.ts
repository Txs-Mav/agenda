/**
 * Collecte Moodle — API JSON, pas de DOM, pas de session fragile.
 *
 *   npm run moodle
 *
 * Ce qu'un passage fait :
 *  1. inventorie les contenus de chaque cours (core_course_get_contents) et
 *     les compare au relevé précédent → data/moodle-nouveautes.json, chaque
 *     entrée avec l'URL EXACTE du document (l'exigence : « le prof a publié,
 *     va voir » avec le lien cliquable) ;
 *  2. lit devoirs (mod_assign) et calendrier d'actions → échéances src
 *     « moodle », fusionnées dans data/deadlines.json — le frais gagne (une
 *     date déplacée suit), le « fait » survit, le supprimé ne revient pas ;
 *  3. régénère export.json / public/data.json et pousse le snapshot Supabase,
 *     exactement comme la collecte Omnivox.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileStore, type Deadline, type Mio } from "../store.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { pushSnapshot, fetchSuppressions } from "../sync/supabase.js";
import { reportNouveautes } from "../notify.js";
import {
  lireJeton, ws, sigleDe, MOODLE_BASE,
  type SiteInfo, type Cours, type SectionCours, type Devoirs, type EvenementsCal,
} from "./api.js";

const aid = (seed: string) =>
  "m" + [...seed].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

const dloc = (unix: number) => {
  const t = new Date(unix * 1000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const hloc = (unix: number) => {
  const t = new Date(unix * 1000);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

/* ---- Inventaire des contenus et nouveautés ------------------------------- */

type Item = { titre: string; cours: string; sigle: string; type: string; url: string; modifie: number };
type Inventaire = { releve: string; items: Record<string, Item> };
type Nouveaute = { quand: string; raison: "nouveau" | "mis à jour"; vu: boolean } & Omit<Item, "modifie">;

async function inventorie(token: string, cours: Cours[]): Promise<Inventaire> {
  const items: Record<string, Item> = {};
  for (const c of cours) {
    const sections = await ws<SectionCours[]>(token, "core_course_get_contents", { courseid: c.id });
    for (const s of sections) {
      for (const m of s.modules ?? []) {
        if (m.visible === 0) continue;
        // Les étiquettes et forums de brèves n'apportent rien à l'agenda.
        if (m.modname === "label" || m.modname === "forum") continue;
        const modifie = Math.max(0, ...(m.contents ?? []).map((f) => f.timemodified ?? 0));
        items[`${c.id}:${m.id}`] = {
          titre: m.name,
          cours: c.fullname,
          sigle: sigleDe(c.shortname, c.fullname),
          type: m.modname,
          url: m.url || m.contents?.[0]?.fileurl || `${MOODLE_BASE}/course/view.php?id=${c.id}`,
          modifie,
        };
      }
    }
  }
  return { releve: new Date().toISOString(), items };
}

function diffNouveautes(avant: Inventaire | null, apres: Inventaire): Nouveaute[] {
  if (!avant) return []; // premier relevé : référence, pas une avalanche
  const out: Nouveaute[] = [];
  for (const [cle, item] of Object.entries(apres.items)) {
    const prev = avant.items[cle];
    if (prev && item.modifie <= prev.modifie) continue;
    const { modifie: _m, ...reste } = item;
    out.push({ quand: apres.releve, raison: prev ? "mis à jour" : "nouveau", vu: false, ...reste });
  }
  return out;
}

/* ---- Échéances ------------------------------------------------------------ */

async function echeancesMoodle(token: string, cours: Cours[]): Promise<Deadline[]> {
  const out: Deadline[] = [];

  const devoirs = await ws<Devoirs>(token, "mod_assign_get_assignments", {
    courseids: cours.map((c) => c.id),
  });
  for (const c of devoirs.courses ?? []) {
    for (const a of c.assignments ?? []) {
      if (!a.duedate) continue;
      out.push({
        id: aid("assign" + a.id),
        t: a.name,
        course: c.fullname,
        date: dloc(a.duedate),
        time: hloc(a.duedate),
        kind: "remise",
        src: "moodle",
        code: sigleDe(c.shortname, c.fullname),
        done: false,
      });
    }
  }

  // Le calendrier d'actions attrape ce que mod_assign ignore : tests (quiz),
  // rétroactions, ateliers… On saute les devoirs, déjà couverts au-dessus.
  const cal = await ws<EvenementsCal>(token, "core_calendar_get_action_events_by_timesort", {
    timesortfrom: Math.floor(Date.now() / 1000) - 7 * 86400,
    limitnum: 50,
  });
  for (const e of cal.events ?? []) {
    if (e.modulename === "assign" || !e.timesort) continue;
    out.push({
      id: aid("cal" + (e.modulename ?? "") + (e.instance ?? e.id)),
      t: e.name,
      course: e.course?.fullname ?? "",
      date: dloc(e.timesort),
      time: hloc(e.timesort),
      kind: e.modulename === "quiz" ? "examen" : "autre",
      src: "moodle",
      code: sigleDe(e.course?.shortname, e.course?.fullname),
      done: false,
    });
  }

  // Un même id peut sortir deux fois (calendrier relu large) : dernier vu gagne.
  return [...new Map(out.map((d) => [d.id, d])).values()];
}

/**
 * Fusion dans deadlines.json. PAS le merge() d'Omnivox : les identifiants
 * moodle sont stables quand la DATE change (c'est voulu — une remise déplacée
 * par le prof suit sans doublon), donc ici le frais gagne sur l'ancien, et
 * seuls « fait » et les suppressions survivent.
 */
function fusionne(prev: Deadline[], fresh: Deadline[], supprimees: Set<string>): Deadline[] {
  const today = new Date().toISOString().slice(0, 10);
  const freshIds = new Set(fresh.map((f) => f.id));
  const done = new Set(prev.filter((p) => p.done).map((p) => p.id));
  const kept = prev.filter((p) =>
    p.src !== "moodle" || (!freshIds.has(p.id) && (p.done || p.date >= today)));
  return [...kept, ...fresh.map((f) => ({ ...f, done: done.has(f.id) }))]
    .filter((d) => !supprimees.has(d.id));
}

/* ---- Le passage ----------------------------------------------------------- */

try {
  const jeton = lireJeton();
  if (!jeton) {
    log.error("Aucun jeton Moodle. Lance d'abord : npm run moodle-login");
    process.exit(2);
  }

  log.step(`Collecte Moodle (${jeton.host})`);
  const info = await ws<SiteInfo>(jeton.token, "core_webservice_get_site_info");
  const tous = await ws<Cours[]>(jeton.token, "core_enrol_get_users_courses", {
    userid: info.userid, returnusercount: 0,
  });
  const maintenant = Math.floor(Date.now() / 1000);
  const cours = tous.filter((c) =>
    c.visible !== 0 && (!c.enddate || c.enddate > maintenant - 60 * 86400));
  log.info(`${cours.length} cours actifs (${tous.length} au total)`);

  const avant = fileStore.read<Inventaire | null>("moodle-contenus", null);
  const apres = await inventorie(jeton.token, cours);
  fileStore.write("moodle-contenus", apres);
  const fraiches = diffNouveautes(avant, apres);
  if (!avant) {
    log.info(`premier relevé : ${Object.keys(apres.items).length} contenus en référence — les nouveautés seront détectées dès le prochain passage.`);
  } else if (fraiches.length) {
    const toutes = [...fraiches, ...fileStore.read<Nouveaute[]>("moodle-nouveautes", [])].slice(0, 100);
    fileStore.write("moodle-nouveautes", toutes);
    for (const n of fraiches) log.info(`${n.raison} — ${n.sigle || n.cours} : ${n.titre}`);
    await reportNouveautes(fraiches.length, `${fraiches[0]!.titre} (${fraiches[0]!.sigle || fraiches[0]!.cours})`);
  } else {
    log.info("aucun nouveau contenu de cours");
  }

  const supprimees = await fetchSuppressions();
  const fresh = (await echeancesMoodle(jeton.token, cours)).filter((d) => !supprimees.has(d.id));
  log.info(`${fresh.length} échéances Moodle (devoirs + calendrier)`);

  const prevD = fileStore.read<Deadline[]>("deadlines", []);
  const nextD = fusionne(prevD, fresh, supprimees);
  fileStore.write("deadlines", nextD);

  const mios = fileStore.read<Mio[]>("mios", []);
  const payload = { lastScrape: new Date().toISOString(), mios, deadlines: nextD };
  fileStore.write("export", payload);
  try {
    writeFileSync(join(process.cwd(), "public", "data.json"), JSON.stringify(payload, null, 2));
  } catch {}
  log.info(`${nextD.length} échéances au total dans l'agenda`);

  await pushSnapshot(payload);
} catch (err) {
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
