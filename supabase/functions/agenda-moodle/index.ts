/**
 * agenda-moodle — la collecte qui ne demande aucun appareil allumé.
 *
 * C'est la pièce qui fait de l'iPad un citoyen de première classe. Omnivox
 * exige une session de navigateur et arme un captcha au moindre login : il
 * restera sur les appareils. Moodle, lui, expose une API JSON avec un jeton
 * durable — aucune raison qu'un étudiant doive posséder un Mac pour voir ses
 * remises.
 *
 * Deux façons d'entrer, et une seule porte :
 *
 *   Bearer <clé de service>  → passage pour TOUS les comptes qui ont déposé
 *                              un jeton. C'est ce qu'appelle le cron horaire.
 *   Bearer <jeton d'un user> → passage pour CE compte seulement. C'est le
 *                              bouton « collecter maintenant » de l'app.
 *
 * La leçon du projet, apprise à la dure sur agenda-resume : `verify_jwt` ne
 * suffit PAS — la passerelle laisse passer la clé publishable présentée en
 * Bearer. On revérifie donc ici, nous-mêmes, AVANT toute autre chose.
 *
 * Ce que la fonction n'écrit jamais : `agenda_item_etat`. Les faits d'un côté,
 * ce que l'étudiant en a fait de l'autre. Une remise cochée « fait » le reste
 * après ce passage, une remise supprimée ne revient pas.
 */
import { createClient } from "npm:@supabase/supabase-js@^2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MOODLE_DEFAUT = Deno.env.get("AGENDA_MOODLE_HOST") ?? "cegeptr.moodle.decclic.qc.ca";

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/* ── Client Moodle ───────────────────────────────────────────────────
   Les erreurs Moodle arrivent en HTTP 200 avec un champ `exception` : un
   `r.ok` seul ne voit rien passer. */
class ErreurMoodle extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function ws<T>(
  site: string, token: string, fn: string,
  params: Record<string, string | number | Array<string | number>> = {},
): Promise<T> {
  const corps = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json" });
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x, i) => corps.set(`${k}[${i}]`, String(x)));
    else corps.set(k, String(v));
  }
  const r = await fetch(`https://${site}/webservice/rest/server.php`, { method: "POST", body: corps });
  if (!r.ok) throw new ErreurMoodle("http", `HTTP ${r.status} sur ${fn}`);
  const d: unknown = await r.json();
  if (d && typeof d === "object" && "exception" in d) {
    const e = d as { errorcode?: string; message?: string };
    throw new ErreurMoodle(e.errorcode ?? "exception", `${fn} : ${e.message ?? "erreur Moodle"}`);
  }
  return d as T;
}

const sigleDe = (...noms: Array<string | undefined>) => {
  for (const n of noms) { const m = /(\d{3}-\w{3}-\w{2})/.exec(n ?? ""); if (m) return m[1]!; }
  return "";
};

type Cours = { id: number; fullname: string; shortname: string; visible?: number; enddate?: number };
type Devoirs = { courses?: Array<{ id: number; fullname: string; shortname: string;
  assignments?: Array<{ id: number; cmid: number; name: string; duedate: number }> }> };
type Cal = { events?: Array<{ id: number; name: string; modulename?: string; instance?: number;
  timesort: number; url?: string; course?: { id?: number; fullname?: string; shortname?: string } }> };

/* Une échéance Moodle est une date à la seconde : `jour_seul` reste faux.
   Quand Moodle dit 23:59, c'est 23:59 — pas « un jour quelque part ». */
const item = (o: Record<string, unknown>) => o;

/** Un passage pour UN compte. Rend le nombre d'items écrits. */
async function passage(sb: ReturnType<typeof createClient>, ligne: {
  user_id: string; site: string; jeton: string;
}): Promise<{ items: number; cours: number }> {
  const { site, jeton, user_id } = ligne;
  const info = await ws<{ userid: number }>(site, jeton, "core_webservice_get_site_info");
  const tous = await ws<Cours[]>(site, jeton, "core_enrol_get_users_courses",
    { userid: info.userid, returnusercount: 0 });
  const maintenant = Math.floor(Date.now() / 1000);
  /* Les cours finis depuis plus de deux mois ne portent plus rien d'utile,
     et interroger 40 cours d'archives pour rien coûte du temps à tout le
     monde. */
  const cours = tous.filter((c) => c.visible !== 0 && (!c.enddate || c.enddate > maintenant - 60 * 86400));

  const items: Array<Record<string, unknown>> = [];
  const nomDe = new Map(cours.map((c) => [c.id, c]));

  if (cours.length) {
    const devoirs = await ws<Devoirs>(site, jeton, "mod_assign_get_assignments",
      { courseids: cours.map((c) => c.id) });
    for (const c of devoirs.courses ?? []) {
      for (const a of c.assignments ?? []) {
        if (!a.duedate) continue;
        items.push(item({
          user_id, id: `moodle:assign:${a.id}`, source: "moodle", genre: "devoir",
          cours: c.fullname, code_cours: sigleDe(c.shortname, c.fullname),
          moodle_course_id: c.id, titre: a.name,
          // La page du devoir lui-même — celle où l'on remet, pas l'accueil du cours.
          url: `https://${site}/mod/assign/view.php?id=${a.cmid}`,
          echeance_le: new Date(a.duedate * 1000).toISOString(),
          jour_seul: false, collecte_le: new Date().toISOString(),
        }));
      }
    }
  }

  /* Le calendrier d'actions attrape ce que mod_assign ignore : tests, ateliers,
     rétroactions. On saute les devoirs, déjà couverts au-dessus. */
  const cal = await ws<Cal>(site, jeton, "core_calendar_get_action_events_by_timesort",
    { timesortfrom: maintenant - 7 * 86400, limitnum: 50 });
  for (const e of cal.events ?? []) {
    if (e.modulename === "assign" || !e.timesort) continue;
    const c = e.course?.id ? nomDe.get(e.course.id) : undefined;
    items.push(item({
      user_id, id: `moodle:cal:${e.modulename ?? ""}:${e.instance ?? e.id}`,
      source: "moodle", genre: e.modulename === "quiz" ? "examen" : "autre",
      cours: e.course?.fullname ?? c?.fullname ?? "",
      code_cours: sigleDe(e.course?.shortname, e.course?.fullname),
      moodle_course_id: e.course?.id ?? null,
      titre: e.name, url: e.url ?? null,
      echeance_le: new Date(e.timesort * 1000).toISOString(),
      jour_seul: false, collecte_le: new Date().toISOString(),
    }));
  }

  /* Un même id peut sortir deux fois (calendrier relu large) : dernier vu
     gagne, sinon l'upsert se plaint d'un doublon dans le même lot. */
  const uniques = [...new Map(items.map((i) => [i.id as string, i])).values()];
  if (uniques.length) {
    const { error } = await sb.from("agenda_items").upsert(uniques, { onConflict: "user_id,id" });
    if (error) throw new Error(`agenda_items : ${error.message}`);
  }

  await sb.from("agenda_moodle_inscriptions").upsert(
    cours.map((c) => ({ user_id, moodle_course_id: c.id, nom: c.fullname,
                        court: c.shortname, updated_at: new Date().toISOString() })),
    { onConflict: "user_id,moodle_course_id" });

  return { items: uniques.length, cours: cours.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ erreur: "POST seulement" }, 405);

  const porteur = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!porteur) return json({ erreur: "jeton absent" }, 401);

  const sb = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  /* Qui appelle ? La clé de service passe tout le monde ; un jeton
     d'utilisateur ne passe que lui. Rien d'autre n'entre — surtout pas la
     clé publishable, que la passerelle laisse pourtant filer. */
  let cible: string | null = null;
  if (porteur !== SERVICE) {
    const { data, error } = await sb.auth.getUser(porteur);
    if (error || !data.user) return json({ erreur: "jeton invalide" }, 401);
    cible = data.user.id;
  }

  let q = sb.from("agenda_moodle_jetons").select("user_id, site, jeton");
  if (cible) q = q.eq("user_id", cible);
  const { data: jetons, error } = await q;
  if (error) return json({ erreur: error.message }, 500);
  if (!jetons?.length) return json({ comptes: 0, note: "aucun jeton Moodle déposé" });

  const bilan: Array<Record<string, unknown>> = [];
  for (const j of jetons as Array<{ user_id: string; site: string; jeton: string }>) {
    try {
      const r = await passage(sb, { ...j, site: j.site || MOODLE_DEFAUT });
      await sb.from("agenda_moodle_jetons")
        .update({ valide_le: new Date().toISOString(), erreur: null })
        .eq("user_id", j.user_id);
      bilan.push({ compte: j.user_id.slice(0, 8), ...r });
    } catch (e) {
      /* Un jeton mort ne doit pas emporter le passage des autres. On le
         consigne sur SA ligne : l'app y lira « ta collecte Moodle est en
         panne », avec la raison, sans qu'on ait à surveiller un journal. */
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from("agenda_moodle_jetons")
        .update({ erreur: msg.slice(0, 300) }).eq("user_id", j.user_id);
      bilan.push({ compte: j.user_id.slice(0, 8), erreur: msg.slice(0, 200) });
    }
  }
  return json({ comptes: jetons.length, bilan });
});
