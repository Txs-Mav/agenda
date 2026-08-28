/**
 * agenda-resume — le seul morceau de serveur de l'agenda.
 *
 * Deux services derrière une seule porte :
 *
 *   POST ?mode=audio   multipart — un morceau de cours enregistré → son texte.
 *                      Whisper via Groq : huit heures d'audio par jour sans
 *                      rien payer, et une justesse que la reconnaissance du
 *                      navigateur n'approche pas dans une salle bruyante.
 *   POST (JSON)        le texte accumulé → des notes rédigées, par Claude.
 *
 * Ce relais n'existe que pour une raison : une clé d'API ne peut pas vivre
 * dans un fichier HTML que tout le monde télécharge. Il ne garde rien — ni le
 * son, ni le texte. Les seules traces sont des compteurs dans
 * `agenda_ia_usage`, pour que la fonction ne devienne pas une facture surprise.
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
const MAX_AUDIO = 20 * 1024 * 1024;   // le palier gratuit de Groq plafonne à 25 Mo
/* Whisper n'accepte que 224 jetons d'amorce — environ 500 caractères. Au-delà
   il tronque, et c'est la FIN du contexte qui compte pour enchaîner. */
const MAX_AMORCE = 500;

const PLAFOND = Number(Deno.env.get("AGENDA_IA_PLAFOND") ?? "80");
const PLAFOND_AUDIO = Number(Deno.env.get("AGENDA_AUDIO_PLAFOND") ?? "300");
const MODELE = Deno.env.get("AGENDA_IA_MODELE") ?? "claude-haiku-4-5";
const MODELE_AUDIO = Deno.env.get("AGENDA_AUDIO_MODELE") ?? "whisper-large-v3-turbo";

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

     Et ce contrôle-ci n'est pas une redondance. Vérifié le 27 août 2026 : la
     passerelle laisse passer la clé publique de l'app présentée en Bearer,
     alors qu'elle n'appartient à personne. Elle ne bloque que l'en-tête
     absent ou un jeton invalide. La vraie porte, c'est cette ligne — sans
     compte, pas de quota à débiter, donc pas d'appel. */
  const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: { user } } = await admin.auth.getUser(jeton);
  if (!user) return repond({ erreur: "Connecte-toi pour utiliser le résumé." }, 401);

  /* Réserver sa place avant d'appeler qui que ce soit, en une instruction
     atomique : deux onglets qui transcrivent le même cours ne peuvent pas
     passer tous les deux par la dernière place. */
  const reserver = async (genre: "ia" | "audio") => {
    const plafond = genre === "audio" ? PLAFOND_AUDIO : PLAFOND;
    const { data, error } = await admin.rpc("agenda_ia_reserver",
      { p_user: user.id, p_plafond: plafond, p_genre: genre });
    if (error) { console.error("quota", error.message); return { panne: true }; }
    return data as { permis: boolean; appels: number; plafond: number };
  };

  const modeUrl = new URL(req.url).searchParams.get("mode");

  /* ══ Un morceau de cours devient du texte ═════════════════════════ */
  if (modeUrl === "audio") {
    const GROQ = Deno.env.get("GROQ_API_KEY");
    if (!GROQ) return repond({ erreur: "La transcription n'est pas configurée côté serveur." }, 503);

    let form: FormData;
    try { form = await req.formData(); }
    catch { return repond({ erreur: "Envoi audio illisible." }, 400); }

    const fichier = form.get("audio");
    if (!(fichier instanceof File) || fichier.size === 0) {
      return repond({ erreur: "Aucun son reçu." }, 400);
    }
    if (fichier.size > MAX_AUDIO) {
      return repond({ erreur: "Morceau trop lourd — découpe plus court." }, 413);
    }
    /* L'amorce : la fin de ce qui précède. Whisper s'en sert pour enchaîner
       sur la bonne graphie et le bon vocabulaire d'une découpe à l'autre —
       c'est ce qui rattrape les mots coupés en deux entre deux morceaux. */
    const amorce = coupe(form.get("contexte"), MAX_AMORCE);

    const q = await reserver("audio");
    if ("panne" in q) return repond({ erreur: "Le compteur d'usage n'a pas répondu." }, 500);
    if (!q.permis) {
      return repond({
        erreur: `Plafond de transcription atteint pour aujourd'hui (${q.plafond} morceaux).`,
        appels: q.appels, plafond: q.plafond,
      }, 429);
    }

    try {
      const gf = new FormData();
      gf.append("file", fichier, "morceau.webm");
      gf.append("model", MODELE_AUDIO);
      gf.append("language", "fr");
      gf.append("response_format", "verbose_json");   // pour la durée, qu'on comptabilise
      gf.append("temperature", "0");
      if (amorce) gf.append("prompt", amorce);

      const gr = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { authorization: `Bearer ${GROQ}` }, body: gf,
      });
      if (!gr.ok) {
        const detail = await gr.text().catch(() => "");
        console.error("groq", gr.status, detail.slice(0, 300));
        if (gr.status === 429) {
          return repond({ erreur: "Transcription saturée — ça reprend dans un instant." }, 429);
        }
        if (gr.status === 401 || gr.status === 403) {
          return repond({ erreur: "La transcription est mal configurée côté serveur." }, 503);
        }
        return repond({ erreur: "La transcription a échoué pour ce morceau." }, 502);
      }
      const d = await gr.json();
      const texte = String(d.text ?? "").trim();
      const secondes = Math.round(Number(d.duration) || 0);

      await admin.rpc("agenda_ia_noter",
        { p_user: user.id, p_in: 0, p_out: 0, p_sec: secondes });

      return repond({ texte, vide: !texte, secondes, appels: q.appels, plafond: q.plafond });
    } catch (e) {
      console.error("groq", e instanceof Error ? e.message : String(e));
      return repond({ erreur: "La transcription n'a pas abouti — le morceau suivant réessaiera." }, 502);
    }
  }

  /* ══ Le texte accumulé devient des notes ══════════════════════════ */
  const CLE = Deno.env.get("ANTHROPIC_API_KEY");
  if (!CLE) return repond({ erreur: "Le résumé n'est pas encore configuré côté serveur." }, 503);

  let corps: Record<string, unknown>;
  try { corps = await req.json(); }
  catch { return repond({ erreur: "Requête illisible." }, 400); }

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

  const q = await reserver("ia");
  if ("panne" in q) return repond({ erreur: "Le compteur d'usage n'a pas répondu." }, 500);
  if (!q.permis) {
    return repond({
      erreur: `Plafond du jour atteint (${q.plafond} résumés). ` +
        `La transcription continue — seul le résumé se met en pause jusqu'à demain.`,
      appels: q.appels, plafond: q.plafond,
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

    await admin.rpc("agenda_ia_noter", {
      p_user: user.id,
      p_in: reponse.usage.input_tokens ?? 0,
      p_out: reponse.usage.output_tokens ?? 0,
      p_sec: 0,
    });

    if (reponse.stop_reason === "refusal") {
      return repond({ erreur: "Ce passage n'a pas pu être résumé." }, 422);
    }

    return repond({
      texte,
      vide: !texte || texte === "(rien à noter)",
      appels: q.appels,
      plafond: q.plafond,
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
