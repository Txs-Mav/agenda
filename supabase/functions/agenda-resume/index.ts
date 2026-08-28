/**
 * agenda-resume — le seul morceau de serveur de l'agenda.
 *
 * La page de notes écoute le cours et transcrit sur l'appareil. Quand assez de
 * paroles se sont accumulées, elle les envoie ici et reçoit en retour des notes
 * écrites, prêtes à s'ajouter sous celles d'avant.
 *
 * Ce relais n'existe que pour une raison : une clé d'API ne peut pas vivre dans
 * un fichier HTML que tout le monde télécharge. Il ne garde rien — le transcript
 * traverse et repart, il n'atterrit dans aucune table. Les seules traces sont
 * des compteurs dans `agenda_ia_usage`, pour que la fonction ne devienne pas
 * une facture surprise.
 */
import Anthropic from "npm:@anthropic-ai/sdk@^0.120.0";
import { createClient } from "npm:@supabase/supabase-js@^2";

/* ── Ce qu'on accepte ────────────────────────────────────────────────
   La production, les préversions Vercel du même projet, et le poste de
   développement. Le CORS n'est ici qu'une ceinture de plus : la vraie porte,
   c'est le jeton de session, et chaque appel se retient sur le quota de son
   propre compte. */
const ORIGINES = [
  /^https:\/\/agenda-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const entete = (origine: string | null) => {
  const permis = origine && ORIGINES.some((r) => r.test(origine)) ? origine : "";
  return {
    "access-control-allow-origin": permis,
    "access-control-allow-headers": "authorization, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "3600",
    "vary": "origin",
    "content-type": "application/json; charset=utf-8",
  };
};

/* Bornes d'entrée. Un segment de 12 000 caractères, c'est déjà une dizaine de
   minutes de parole : au-delà, c'est un client qui déraille, pas un cours. */
const MAX_SEGMENT = 12_000;
const MAX_CONTEXTE = 1_500;
const MAX_NOTES = 60_000;
const PLAFOND = Number(Deno.env.get("AGENDA_IA_PLAFOND") ?? "80");
const MODELE = Deno.env.get("AGENDA_IA_MODELE") ?? "claude-haiku-4-5";

const coupe = (v: unknown, max: number) =>
  typeof v === "string" ? v.slice(0, max).trim() : "";

/* ── Comment on écrit des notes ──────────────────────────────────────
   Le ton compte autant que le contenu : ces notes se retrouvent dans une page
   de texte brut, à côté de ce que l'étudiant a écrit à la main. Elles doivent
   se fondre, pas détonner. D'où l'interdiction du balisage Markdown. */
const REGLES = `Comment tu écris :
— Français québécois soutenu, ton de notes de cours : dense, aucune phrase creuse.
— Un titre court sur sa propre ligne quand un nouveau sujet commence.
— Les points sous forme de lignes qui commencent par « — ».
— Aucun symbole de balisage : ni #, ni *, ni **. Ces notes vont dans une page de texte brut.
— Les formules en notation linéaire lisible : v = d / t, x² + 2x − 3.`;

const SYS_SEGMENT = `Tu écris les notes de cours d'un étudiant de cégep, à partir de ce que l'enseignant vient de dire.

Le texte qu'on te donne sort d'une transcription automatique : ponctuation peu fiable, mots mal reconnus, phrases qui repartent à zéro. Tu écris ce que l'étudiant aurait noté s'il avait eu le temps de tout suivre.

Ce que tu gardes : définitions, formules, méthodes et leurs étapes, exemples travaillés, distinctions entre notions voisines, et tout ce qui touche l'évaluation — dates, consignes, « ça pourrait tomber à l'examen ».

Ce que tu jettes : salutations, régie de classe, digressions, répétitions, hésitations, questions d'étudiants restées sans réponse utile.

${REGLES}

Règles absolues :
— N'invente rien. Un passage inaudible ou incohérent, tu l'ignores.
— Ne répète pas ce qui figure déjà dans les notes précédentes qu'on te montre : tu écris la SUITE, pas un résumé du tout.
— Pas de préambule ni de conclusion. Tu produis directement le texte à ajouter.
— Si le segment ne contient rien qui mérite d'être noté, réponds exactement : (rien à noter)`;

const SYS_FINAL = `Tu remets au propre des notes de cours prises en direct, pendant que l'enseignant parlait. Elles ont été écrites segment par segment : il y a des redites, des titres en double, des passages notés deux fois sous deux angles.

Ton travail :
— Regrouper par thème et remettre dans un ordre qui se tient.
— Fusionner les redites sans rien perdre de ce qui était dit.
— Corriger les termes manifestement mal transcrits quand le contexte les rend évidents ; laisser tel quel quand tu n'es pas sûr.
— Terminer par une section « À retenir » si le cours a signalé des éléments évalués, des dates ou des consignes. Sinon, ne l'invente pas.

${REGLES}

Tu produis le document, rien d'autre — pas de préambule.`;

Deno.serve(async (req: Request) => {
  const cors = entete(req.headers.get("origin"));
  const repond = (corps: unknown, status = 200) =>
    new Response(JSON.stringify(corps), { status, headers: cors });

  // Le navigateur demande la permission avant d'envoyer : on répond avant tout
  // le reste, sinon la vraie requête ne part jamais.
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return repond({ erreur: "Méthode refusée." }, 405);

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  /* ── Qui appelle ───────────────────────────────────────────────────
     Premier geste, avant même de regarder si le reste est configuré : un
     inconnu n'a pas à apprendre l'état de nos serveurs.

     Et ce contrôle-ci n'est pas une redondance. Vérifié le 26 août 2026 : la
     passerelle laisse passer la clé publique de l'app présentée en Bearer,
     alors qu'elle n'appartient à personne. Elle bloque l'absence d'en-tête,
     rien de plus. La vraie porte, c'est cette ligne — sans compte, pas de
     quota à débiter, donc pas d'appel. */
  const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: { user } } = await admin.auth.getUser(jeton);
  if (!user) return repond({ erreur: "Connecte-toi pour utiliser le résumé." }, 401);

  const CLE = Deno.env.get("ANTHROPIC_API_KEY");
  if (!CLE) {
    return repond({ erreur: "Le résumé n'est pas encore configuré côté serveur." }, 503);
  }

  let corps: Record<string, unknown>;
  try {
    corps = await req.json();
  } catch {
    return repond({ erreur: "Requête illisible." }, 400);
  }

  const mode = corps.mode === "final" ? "final" : "segment";
  const matiere = coupe(corps.matiere, 120) || "Cours";
  const segment = coupe(corps.segment, MAX_SEGMENT);
  const contexte = coupe(corps.contexte, MAX_CONTEXTE);
  const notes = coupe(corps.notes, MAX_NOTES);

  if (mode === "segment" && segment.length < 40) {
    return repond({ erreur: "Segment trop court pour en tirer des notes." }, 400);
  }
  if (mode === "final" && notes.length < 40) {
    return repond({ erreur: "Rien à mettre au propre." }, 400);
  }

  /* ── Le plafond ────────────────────────────────────────────────────
     Réservé AVANT l'appel, en une instruction atomique : deux onglets qui
     transcrivent le même cours ne peuvent pas passer tous les deux par la
     dernière place. */
  const { data: quota, error: eQuota } = await admin
    .rpc("agenda_ia_reserver", { p_user: user.id, p_plafond: PLAFOND });
  if (eQuota) {
    console.error("quota", eQuota.message);
    return repond({ erreur: "Le compteur d'usage n'a pas répondu." }, 500);
  }
  if (!quota?.permis) {
    return repond({
      erreur: `Plafond du jour atteint (${quota?.plafond ?? PLAFOND} résumés). ` +
        `La transcription continue — seul le résumé automatique se met en pause jusqu'à demain.`,
      appels: quota?.appels ?? PLAFOND,
      plafond: quota?.plafond ?? PLAFOND,
    }, 429);
  }

  const claude = new Anthropic({ apiKey: CLE, timeout: 90_000, maxRetries: 1 });

  try {
    let reponse;
    if (mode === "segment") {
      reponse = await claude.messages.create({
        model: MODELE,
        max_tokens: 1200,
        system: SYS_SEGMENT,
        messages: [{
          role: "user",
          content: `Cours : ${matiere}\n\n` +
            `Fin des notes déjà prises — n'y reviens pas :\n---\n` +
            `${contexte || "(aucune note pour l'instant, c'est le début du cours)"}\n---\n\n` +
            `Ce que l'enseignant vient de dire :\n---\n${segment}\n---`,
        }],
      });
    } else {
      // La mise au propre peut être longue : on diffuse pour ne pas se faire
      // couper par le délai de la passerelle, puis on assemble.
      const flux = claude.messages.stream({
        model: MODELE,
        max_tokens: 6000,
        system: SYS_FINAL,
        messages: [{
          role: "user",
          content: `Cours : ${matiere}\n\nNotes prises en direct :\n---\n${notes}\n---`,
        }],
      });
      reponse = await flux.finalMessage();
    }

    const texte = reponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Ce que ça a coûté, noté après coup : le plafond protège du volume, ces
    // compteurs-là disent le prix réel.
    await admin.rpc("agenda_ia_noter", {
      p_user: user.id,
      p_in: reponse.usage.input_tokens ?? 0,
      p_out: reponse.usage.output_tokens ?? 0,
    });

    if (reponse.stop_reason === "refusal") {
      return repond({ erreur: "Ce passage n'a pas pu être résumé." }, 422);
    }

    return repond({
      texte,
      vide: !texte || texte === "(rien à noter)",
      appels: quota.appels,
      plafond: quota.plafond,
    });
  } catch (e) {
    // Le détail part dans les journaux ; l'étudiant reçoit une phrase utile.
    console.error("claude", e instanceof Error ? e.message : String(e));
    if (e instanceof Anthropic.RateLimitError) {
      return repond({ erreur: "Trop de demandes d'un coup — ça reprend dans un instant." }, 429);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return repond({ erreur: "Le résumé est mal configuré côté serveur." }, 503);
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      return repond({ erreur: "Le résumé a mis trop de temps — le segment suivant réessaiera." }, 504);
    }
    return repond({ erreur: "Le résumé a échoué. La transcription, elle, continue." }, 502);
  }
});
