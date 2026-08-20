import Anthropic from "@anthropic-ai/sdk";
import { fileStore, type Mio, type MioAction, type Deadline } from "../store.js";
import { log } from "../log.js";

/**
 * L'agent MIO : pour chaque nouveau message, UN appel à Claude qui produit à
 * la fois le résumé d'une phrase et les actions d'agenda que le message
 * justifie (échéance datée, tâche, bloc d'horaire). Mêmes garde-fous que
 * l'ancien résumeur :
 *
 *  1. LE MODÈLE LE MOINS CHER — claude-haiku-4-5. Extraire trois champs d'un
 *     courriel de prof n'exige rien de plus.
 *
 *  2. SEULEMENT LES NOUVEAUX — cache par identifiant de MIO (mio-agent.json).
 *     Un message déjà analysé ne repasse jamais par l'API.
 *
 * Sans clé API, rien ne casse : aperçu comme résumé, aucune action.
 */
const MODEL = "claude-haiku-4-5";

/** `corps` retient si l'analyse a vu le message complet : une analyse faite
 *  sur le seul aperçu est refaite dès que le corps devient disponible. */
type Analyse = { summary: string; actions: MioAction[]; corps?: boolean };

const SYSTEM = `Tu es l'agent d'un agenda étudiant de cégep. On te donne un MIO (message interne
Omnivox) : expéditeur, date de réception, et texte. Tu réponds UNIQUEMENT via l'outil analyse_mio.

resume — UNE seule phrase française, factuelle et brève. Conserve ce qui est actionnable :
dates, heures, locaux, travaux, consignes. Pas de préambule.

actions — seulement ce que le message JUSTIFIE CLAIREMENT. Zéro action est fréquent et correct
(bienvenue, promotion, information générale). Types :
- echeance : examen, remise de travail ou autre date butoir, avec date précise (genre: examen |
  remise | autre).
- tache : chose concrète à faire sans date butoir précise (lecture, matériel à apporter,
  inscription à compléter).
- bloc : évènement ponctuel avec plage horaire claire (rencontre, séance spéciale, sortie) qui
  n'est PAS une séance régulière de cours. Un simple rappel du prochain cours n'est jamais un bloc.

Règles :
- Résous les dates relatives (« demain », « lundi prochain ») à partir de la DATE DE RÉCEPTION.
- N'invente jamais de date ni d'heure. En cas de doute sur l'un des champs, omets l'action.
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
            type:  { type: "string", enum: ["echeance", "tache", "bloc"] },
            titre: { type: "string", description: "Court et concret, ex. « Examen 1 — dérivées »." },
            genre: { type: "string", enum: ["examen", "remise", "autre"], description: "echeance seulement." },
            date:  { type: "string", description: "AAAA-MM-JJ — echeance et bloc." },
            heure: { type: "string", description: "HH:MM, ou omis si inconnue — echeance." },
            de:    { type: "integer", minimum: 0, maximum: 23, description: "bloc : heure entière de début." },
            a:     { type: "integer", minimum: 1, maximum: 24, description: "bloc : heure entière de fin." },
            code:  { type: "string", description: "Sigle du cours s'il apparaît, ex. 201-124-RI." },
            cours: { type: "string", description: "Nom du cours si identifiable." },
          },
        },
      },
    },
  },
};

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const jour = (iso: string) => JOURS[new Date(iso + "T12:00:00").getDay()];

const aid = (seed: string) =>
  "a" + [...seed].reduce((acc, c) => ((acc * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

export async function analyzeNew(mios: Mio[], bodies: Record<string, string>): Promise<Mio[]> {
  const cache = fileStore.read<Record<string, Analyse>>("mio-agent", {});
  // Les résumés de l'ancien résumeur servent de repli si l'API est absente.
  const legacy = fileStore.read<Record<string, string>>("mio-summaries", {});
  const nouveaux = mios.filter((m) => !cache[m.id] || (!cache[m.id]!.corps && bodies[m.id]));

  if (!process.env.ANTHROPIC_API_KEY) {
    if (nouveaux.length)
      log.warn(`${nouveaux.length} MIO à analyser, mais ANTHROPIC_API_KEY absente — aperçu conservé.`);
    return apply(mios, cache, legacy);
  }
  if (!nouveaux.length) return apply(mios, cache, legacy);

  log.step(`Analyse de ${nouveaux.length} nouveau${nouveaux.length > 1 ? "x" : ""} MIO (${MODEL})`);
  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);

  for (const m of nouveaux) {
    const corps = bodies[m.id] || "";
    const user = [
      `Aujourd'hui : ${jour(today)} ${today}`,
      `Reçu le : ${jour(m.date)} ${m.date}`,
      `De : ${m.from}`,
      corps ? `Message :\n${corps}` : `Aperçu (message tronqué, corps indisponible) :\n${m.subject}`,
    ].join("\n");

    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "analyse_mio" },
        messages: [{ role: "user", content: user }],
      });
      const call = res.content.find((b) => b.type === "tool_use");
      cache[m.id] = call && call.type === "tool_use"
        ? valide(m, call.input as Record<string, unknown>)
        : { summary: m.subject, actions: [] };
      cache[m.id]!.corps = Boolean(corps);
      const n = cache[m.id]!.actions.length;
      log.info(`${n} action${n > 1 ? "s" : ""} — ${m.subject.slice(0, 50)}…`);
    } catch (err) {
      log.warn(`analyse impossible d'un MIO : ${err instanceof Error ? err.message : err}`);
      cache[m.id] = { summary: legacy[m.id] ?? m.subject, actions: [] };
    }
  }
  fileStore.write("mio-agent", cache);
  return apply(mios, cache, legacy);
}

/** Ne laisse entrer que des actions complètes et bien formées — le modèle
 *  propose, ce filtre dispose. Une échéance sans date devient une tâche. */
function valide(m: Mio, input: Record<string, unknown>): Analyse {
  const summary = typeof input.resume === "string" && input.resume.trim()
    ? input.resume.trim() : m.subject;
  const brutes = Array.isArray(input.actions) ? input.actions : [];
  const actions: MioAction[] = [];

  for (const raw of brutes.slice(0, 4)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const t = typeof r.titre === "string" ? r.titre.trim().slice(0, 70) : "";
    if (!t) continue;
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "";
    const time = typeof r.heure === "string" && /^\d{1,2}:\d{2}$/.test(r.heure)
      ? r.heure.padStart(5, "0") : "";
    const code = typeof r.code === "string" && /^\d{3}-\w{3}-\w{2}$/.test(r.code) ? r.code : "";
    const course = typeof r.cours === "string" ? r.cours.trim().slice(0, 50) : "";
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
