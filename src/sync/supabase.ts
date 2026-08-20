import { log } from "../log.js";
import { registerSecret } from "../redact.js";

/**
 * Pousse le snapshot dérivé (échéances + MIO résumés) vers Supabase, sous le
 * compte de L'UTILISATEUR (courriel + mot de passe d'agenda, PAS les
 * identifiants Omnivox — ceux-là ne quittent jamais la machine).
 *
 * RLS côté base : chacun ne peut écrire et lire que ses propres lignes.
 * Entièrement facultatif : sans les variables, on saute en silence.
 */
const URL_ = process.env.SUPABASE_URL || "https://olkbhrbyubejetqygdcy.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X";

export async function pushSnapshot(payload: unknown, kind: "export" | "horaire" = "export"): Promise<void> {
  const email = process.env.AGENDA_EMAIL, pass = process.env.AGENDA_PASSWORD;
  if (!email || !pass) return; // pas de compte configuré : pur local, rien à faire
  registerSecret(pass);

  try {
    const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password: pass }),
    });
    if (!auth.ok) {
      log.warn(`Supabase : connexion refusée (${auth.status}) — snapshot non poussé.`);
      return;
    }
    const { access_token, user } = (await auth.json()) as { access_token: string; user: { id: string } };
    registerSecret(access_token);

    const up = await fetch(`${URL_}/rest/v1/agenda_snapshots`, {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: `Bearer ${access_token}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([{ user_id: user.id, kind, payload }]),
    });
    if (!up.ok) {
      log.warn(`Supabase : écriture refusée (${up.status}) — ${(await up.text()).slice(0, 120)}`);
      return;
    }
    log.info(`snapshot « ${kind} » poussé vers Supabase (compte ` + email.replace(/(.).+(@.+)/, "$1***$2") + ")");
  } catch (err) {
    log.warn(`Supabase inaccessible : ${err instanceof Error ? err.message : err}`);
  }
}
