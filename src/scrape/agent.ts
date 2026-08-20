import Anthropic from "@anthropic-ai/sdk";
import { fileStore, type Mio, type MioAction, type Deadline } from "../store.js";
import { log } from "../log.js";

/**
 * L'agent MIO : pour chaque nouveau message, UN appel à Claude qui produit à
 * la fois le résumé d'une phrase et les actions d'agenda que le message
 * justifie. L'agent ne travaille pas à l'aveugle : il reçoit l'horaire
 * régulier (data/horaire.json) et les échéances déjà connues, ce qui lui
 * permet d'éviter les doublons avec Léa, de ne pas confondre une séance
 * régulière avec un évènement, et de REPORTER ou ANNULER une échéance
 * existante quand un prof change ses plans.
 *
 * Garde-fous :
 *
 *  1. claude-sonnet-5 — la finesse d'extraction vaut les quelques cents par
 *     semaine ; le volume reste minuscule (nouveaux messages seulement).
 *
 *  2. SEULEMENT LES NOUVEAUX — cache par identifiant de MIO (mio-agent.json).
 *     Une analyse est refaite uniquement quand le corps du message devient
 *     disponible, ou quand VERSION monte (prompt/modèle améliorés).
 *
 * Sans clé API, rien ne casse : aperçu comme résumé, aucune action.
 */
const MODEL = "claude-sonnet-5";
const VERSION = 2;

/** `corps` : l'analyse a vu le message complet. `v` : version du pipeline. */
type Analyse = { summary: string; actions: MioAction[]; corps?: boolean; v?: number };

type TTRow = { d: number; h: [number, number]; t: string; k?: string; code?: string; room?: string };

/** Une échéance que l'agent peut viser avec reporter/annuler. */
type Connue = { id: string; label: string };

const SYSTEM = `Tu es l'agent d'un agenda étudiant de cégep. On te donne l'HORAIRE RÉGULIER de
l'étudiant, ses ÉCHÉANCES CONNUES (déjà dans l'agenda), puis un MIO (message interne Omnivox).
Tu réponds UNIQUEMENT via l'outil analyse_mio.

resume — UNE seule phrase française, factuelle et brève. Conserve ce qui est actionnable :
dates, heures, locaux, travaux, consignes. Pas de préambule.

actions — seulement ce que le message JUSTIFIE CLAIREMENT. Zéro action est fréquent et correct
(bienvenue, promotion, information générale). Types :
- echeance : examen, remise de travail ou autre date butoir, avec date précise (genre: examen |
  remise | autre).
- tache : chose concrète à faire sans date butoir précise (lecture, matériel à apporter,
  inscription à compléter).
- bloc : évènement ponctuel avec plage horaire claire (rencontre, séance spéciale, sortie).
- reporter : une échéance d'ÉCHÉANCES CONNUES change de date — cible = son identifiant entre
  crochets, recopié tel quel, avec la nouvelle date (et heure si donnée).
- annuler : une échéance d'ÉCHÉANCES CONNUES est annulée — cible = son identifiant.

Règles :
- Une séance régulière de l'HORAIRE n'est JAMAIS une action : un rappel de cours, un contenu de
  séance, un local habituel n'apportent rien à l'agenda.
- Ne recrée JAMAIS une échéance déjà présente dans ÉCHÉANCES CONNUES ; si le message la modifie,
  utilise reporter ou annuler avec la cible exacte. En cas de correspondance douteuse, n'émets rien.
- Un bloc ne doit pas chevaucher l'HORAIRE, sauf évènement obligatoire qui remplace le cours.
- Résous les dates relatives (« demain », « lundi prochain ») à partir de la DATE DE RÉCEPTION.
- N'invente jamais de date ni d'heure. En cas de doute sur un champ, omets l'action.
- Reprends le sigle du cours (ex. 201-124-RI) seulement s'il apparaît dans le message.`;

const TOOL: Anthropic.Tool = {
  name: "analyse_mio",
  description: "Consigne le résumé du MIO et les actions d'agenda qu'il justifie.",
  input_schema: {
    type: "object",
    required: ["resume", "actions"],
    properties: {
      resume: { type: "string", description: "Une seule phrase française." },
      actions: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "titre"],
          properties: {
            type:  { type: "string", enum: ["echeance", "tache", "bloc", "reporter", "annuler"] },
            titre: { type: "string", description: "Court et concret, ex. « Examen 1 — dérivées »." },
            genre: { type: "string", enum: ["examen", "remise", "autre"], description: "echeance seulement." },
            date:  { type: "string", description: "AAAA-MM-JJ — echeance, bloc, reporter." },
            heure: { type: "string", description: "HH:MM, ou omis si inconnue — echeance, reporter." },
            de:    { type: "integer", minimum: 0, maximum: 23, description: "bloc : heure entière de début." },
            a:     { type: "integer", minimum: 1, maximum: 24, description: "bloc : heure entière de fin." },
            cible: { type: "string", description: "reporter/annuler : identifiant [entre crochets] de l'échéance visée, recopié tel quel." },
            code:  { type: "string", description: "Sigle du cours s'il apparaît, ex. 201-124-RI." },
            cours: { type: "string", description: "Nom du cours si identifiable." },
          },
        },
      },
    },
  },
};

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const JOURS_TT = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const jour = (iso: string) => JOURS[new Date(iso + "T12:00:00").getDay()];

const aid = (seed: string) =>
  "a" + [...seed].reduce((acc, c) => ((acc * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

/** Coupe à ~n caractères sans casser un mot. */
const cut = (s: string, n: number) =>
  s.length <= n ? s : (s.slice(0, n + 1).replace(/\s+\S*$/, "").trimEnd() || s.slice(0, n));

/** L'horaire régulier en quelques lignes : « lundi : 12–14 Philo (HA3325)… ». */
function horaireTexte(): string {
  const tt = fileStore.read<{ tt?: TTRow[] }>("horaire", {}).tt ?? [];
  if (!tt.length) return "(horaire inconnu)";
  const parJour = new Map<number, string[]>();
  for (const r of tt) {
    if (!parJour.has(r.d)) parJour.set(r.d, []);
    parJour.get(r.d)!.push(`${r.h[0]}–${r.h[1]} ${r.t}${r.code ? ` (${r.code})` : ""}`);
  }
  return [...parJour.entries()].sort((x, y) => x[0] - y[0])
    .map(([d, cours]) => `${JOURS_TT[d] ?? `jour ${d}`} : ${cours.join(", ")}`)
    .join("\n");
}

const connueLabel = (d: Deadline) =>
  `${d.date}${d.time ? " " + d.time : ""} ${d.kind} — ${d.t}${d.code ? ` (${d.code})` : ""}`;

export async function analyzeNew(
  mios: Mio[],
  bodies: Record<string, string>,
  deadlines: Deadline[] = [],
): Promise<Mio[]> {
  const cache = fileStore.read<Record<string, Analyse>>("mio-agent", {});
  // Les résumés de l'ancien résumeur servent de repli si l'API est absente.
  const legacy = fileStore.read<Record<string, string>>("mio-summaries", {});
  const doitAnalyser = (m: Mio) => {
    const c = cache[m.id];
    return !c || (c.v ?? 1) < VERSION || (!c.corps && !!bodies[m.id]);
  };
  const nouveaux = mios.filter(doitAnalyser);

  if (!process.env.ANTHROPIC_API_KEY) {
    if (nouveaux.length)
      log.warn(`${nouveaux.length} MIO à analyser, mais ANTHROPIC_API_KEY absente — aperçu conservé.`);
    return apply(mios, cache, legacy);
  }
  if (!nouveaux.length) return apply(mios, cache, legacy);

  log.step(`Analyse de ${nouveaux.length} MIO (${MODEL})`);
  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);
  const horaire = horaireTexte();

  // Les échéances que reporter/annuler peuvent viser : celles de Léa et du
  // manuel, plus les échéances créées par l'agent sur les messages PRÉCÉDENTS
  // — on analyse du plus ancien au plus récent pour qu'un message puisse
  // corriger ce qu'un autre a annoncé.
  const connues: Connue[] = deadlines.map((d) => ({ id: d.id, label: connueLabel(d) }));
  const ordre = [...mios].sort((x, y) => x.date.localeCompare(y.date));

  for (const m of ordre) {
    if (doitAnalyser(m)) {
      const corps = bodies[m.id] || "";
      const user = [
        `HORAIRE RÉGULIER (session en cours) :\n${horaire}`,
        `ÉCHÉANCES CONNUES :\n${connues.length
          ? connues.map((c) => `[${c.id}] ${c.label}`).join("\n") : "(aucune)"}`,
        `Aujourd'hui : ${jour(today)} ${today}`,
        `MIO reçu le : ${jour(m.date)} ${m.date}`,
        `De : ${m.from}`,
        corps ? `Message :\n${corps}` : `Aperçu (message tronqué, corps indisponible) :\n${m.subject}`,
      ].join("\n\n");

      try {
        const res = await client.messages.create({
          model: MODEL,
          max_tokens: 2000, // le raisonnement adaptatif compte dans ce plafond
          system: SYSTEM,
          tools: [TOOL],
          tool_choice: { type: "tool", name: "analyse_mio" },
          messages: [{ role: "user", content: user }],
        });
        const call = res.content.find((b) => b.type === "tool_use");
        cache[m.id] = call && call.type === "tool_use"
          ? valide(m, call.input as Record<string, unknown>, new Set(connues.map((c) => c.id)))
          : { summary: m.subject, actions: [] };
        cache[m.id]!.corps = Boolean(corps);
        cache[m.id]!.v = VERSION;
        const n = cache[m.id]!.actions.length;
        log.info(`${n} action${n > 1 ? "s" : ""} — ${m.subject.slice(0, 50)}…`);
      } catch (err) {
        log.warn(`analyse impossible d'un MIO : ${err instanceof Error ? err.message : err}`);
        // Pas de version ni de corps : l'analyse sera retentée au prochain passage.
        cache[m.id] = cache[m.id] ?? { summary: legacy[m.id] ?? m.subject, actions: [] };
      }
    }
    // Les échéances de ce MIO (fraîches ou en cache) deviennent visibles
    // pour les messages suivants.
    for (const a of cache[m.id]?.actions ?? [])
      if (a.type === "echeance" && a.date)
        connues.push({ id: a.id, label: `${a.date}${a.time ? " " + a.time : ""} ${a.kind} — ${a.t}` });
  }
  fileStore.write("mio-agent", cache);
  return apply(mios, cache, legacy);
}

/** Ne laisse entrer que des actions complètes et bien formées — le modèle
 *  propose, ce filtre dispose. Une échéance sans date devient une tâche ;
 *  reporter/annuler doivent viser une échéance réellement connue. */
function valide(m: Mio, input: Record<string, unknown>, connues: Set<string>): Analyse {
  const summary = typeof input.resume === "string" && input.resume.trim()
    ? input.resume.trim() : m.subject;
  const brutes = Array.isArray(input.actions) ? input.actions : [];
  const actions: MioAction[] = [];

  for (const raw of brutes.slice(0, 5)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const t = typeof r.titre === "string" ? cut(r.titre.trim(), 70) : "";
    if (!t) continue;
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "";
    const time = typeof r.heure === "string" && /^\d{1,2}:\d{2}$/.test(r.heure)
      ? r.heure.padStart(5, "0") : "";
    const cible = typeof r.cible === "string" ? r.cible.replace(/[[\]]/g, "").trim() : "";
    const code = typeof r.code === "string" && /^\d{3}-\w{3}-\w{2}$/.test(r.code) ? r.code : "";
    const course = typeof r.cours === "string" ? cut(r.cours.trim(), 50) : "";
    const base = { t, code, course };

    if (r.type === "echeance" && date) {
      const kind: Deadline["kind"] =
        r.genre === "examen" || r.genre === "remise" ? r.genre : "autre";
      actions.push({ id: aid(m.id + "e" + t + date + time), type: "echeance", kind, date, time, ...base });
    } else if (r.type === "bloc") {
      const from = Number.isInteger(r.de) ? (r.de as number) : NaN;
      const to = Number.isInteger(r.a) ? (r.a as number) : NaN;
      if (date && from >= 0 && to > from && to <= 24)
        actions.push({ id: aid(m.id + "b" + t + date + from + to), type: "bloc", date, from, to, ...base });
    } else if (r.type === "reporter") {
      if (connues.has(cible) && date)
        actions.push({ id: aid(m.id + "r" + cible + date + time), type: "reporter", target: cible, date, time, ...base });
    } else if (r.type === "annuler") {
      if (connues.has(cible))
        actions.push({ id: aid(m.id + "x" + cible), type: "annuler", target: cible, ...base });
    } else if (r.type === "tache" || r.type === "echeance") {
      actions.push({ id: aid(m.id + "t" + t), type: "tache", ...base });
    }
  }
  return { summary, actions };
}

function apply(mios: Mio[], cache: Record<string, Analyse>, legacy: Record<string, string>): Mio[] {
  return mios.map((m) => ({
    ...m,
    summary: cache[m.id]?.summary ?? legacy[m.id] ?? m.subject,
    actions: cache[m.id]?.actions ?? [],
  }));
}
