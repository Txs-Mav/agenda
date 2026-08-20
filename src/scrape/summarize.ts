import Anthropic from "@anthropic-ai/sdk";
import { fileStore, type Mio } from "../store.js";
import { log } from "../log.js";

/**
 * Résume les MIO en une phrase avec Claude. Deux garde-fous voulus :
 *
 *  1. LE MODÈLE LE MOINS CHER — claude-haiku-4-5 ($1 / $5 par million de
 *     jetons). Un résumé d'une phrase n'a besoin de rien de plus.
 *
 *  2. SEULEMENT LES NOUVEAUX — chaque résumé est mis en cache par identifiant
 *     de MIO. Un message déjà résumé ne repasse jamais par l'API : le coût ne
 *     croît qu'avec les messages réellement nouveaux.
 *
 * Sans clé API, on ne casse rien : le scraper garde l'aperçu de la liste comme
 * résumé et continue.
 */
const MODEL = "claude-haiku-4-5";
const SYSTEM =
  "Tu résumes un message (MIO) reçu par un étudiant de cégep, en UNE seule phrase " +
  "française, factuelle et brève. Conserve ce qui est actionnable : dates, heures, " +
  "locaux, travaux, consignes. Pas de préambule ni de formule d'introduction — " +
  "uniquement la phrase de résumé.";

export async function summarizeNew(mios: Mio[]): Promise<Mio[]> {
  const cache = fileStore.read<Record<string, string>>("mio-summaries", {});
  const nouveaux = mios.filter((m) => !cache[m.id]);

  if (!process.env.ANTHROPIC_API_KEY) {
    if (nouveaux.length)
      log.warn(`${nouveaux.length} MIO à résumer, mais ANTHROPIC_API_KEY absente — aperçu conservé.`);
    return applyCache(mios, cache);
  }
  if (!nouveaux.length) return applyCache(mios, cache);

  log.step(`Résumé de ${nouveaux.length} nouveau${nouveaux.length > 1 ? "x" : ""} MIO (${MODEL})`);
  const client = new Anthropic();

  for (const m of nouveaux) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 90,
        system: SYSTEM,
        messages: [{ role: "user", content: `${m.from} — ${m.subject}` }],
      });
      if (res.stop_reason === "refusal") { cache[m.id] = m.subject; continue; }
      const txt = res.content.find((b) => b.type === "text");
      cache[m.id] = txt && "text" in txt ? txt.text.trim() : m.subject;
    } catch (err) {
      log.warn(`résumé impossible pour un MIO : ${err instanceof Error ? err.message : err}`);
      cache[m.id] = m.subject; // repli : l'aperçu tient lieu de résumé
    }
  }
  fileStore.write("mio-summaries", cache);
  log.info(`${nouveaux.length} résumé(s) ajouté(s) au cache`);
  return applyCache(mios, cache);
}

function applyCache(mios: Mio[], cache: Record<string, string>): Mio[] {
  return mios.map((m) => ({ ...m, summary: cache[m.id] ?? m.subject }));
}
