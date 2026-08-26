import { fileStore } from "../store.js";
import { registerSecret } from "../redact.js";

/**
 * Client des services web Moodle (cegeptr.moodle.decclic.qc.ca — vérifié :
 * services mobiles actifs). Contrairement à Omnivox : une API JSON officielle,
 * un jeton durable, pas de captcha — c'est ce qui permettra à cette collecte
 * de tourner côté serveur, machines éteintes ou pas.
 */
export const MOODLE_HOST = process.env.MOODLE_HOST || "cegeptr.moodle.decclic.qc.ca";
export const MOODLE_BASE = `https://${MOODLE_HOST}`;

/** Jeton de service web, rangé dans data/ (gitignoré), jamais dans le dépôt. */
export type Jeton = { host: string; token: string; privatetoken?: string; obtenu: string };

export function lireJeton(): Jeton | null {
  const j = fileStore.read<Jeton | null>("moodle-token", null);
  if (!j?.token) return null;
  registerSecret(j.token);
  registerSecret(j.privatetoken);
  return j;
}

export function ecrireJeton(token: string, privatetoken?: string): void {
  registerSecret(token);
  registerSecret(privatetoken);
  fileStore.write("moodle-token", {
    host: MOODLE_HOST, token, privatetoken, obtenu: new Date().toISOString(),
  } satisfies Jeton);
}

export class MoodleError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Un appel REST. Les erreurs Moodle arrivent en 200 avec `exception`. */
export async function ws<T>(
  token: string,
  fn: string,
  params: Record<string, string | number | Array<string | number>> = {},
): Promise<T> {
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json" });
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x, i) => body.set(`${k}[${i}]`, String(x)));
    else body.set(k, String(v));
  }
  const r = await fetch(`${MOODLE_BASE}/webservice/rest/server.php`, { method: "POST", body });
  if (!r.ok) throw new MoodleError("http", `HTTP ${r.status} sur ${fn}`);
  const data: unknown = await r.json();
  if (data && typeof data === "object" && "exception" in data) {
    const e = data as { errorcode?: string; message?: string };
    throw new MoodleError(e.errorcode ?? "exception", `${fn} : ${e.message ?? "erreur Moodle"}`);
  }
  return data as T;
}

/* ---- Réponses utilisées (champs retenus seulement) ----------------------- */

export type SiteInfo = { userid: number; fullname: string; sitename: string };

export type Cours = {
  id: number; fullname: string; shortname: string;
  visible?: number; enddate?: number;
};

export type Fichier = { filename?: string; fileurl?: string; timemodified?: number };

export type ModuleCours = {
  id: number; name: string; modname: string; url?: string;
  visible?: number; contents?: Fichier[];
};

export type SectionCours = { name: string; modules: ModuleCours[] };

export type Devoirs = {
  courses: Array<{
    id: number; fullname: string; shortname: string;
    assignments: Array<{ id: number; cmid: number; name: string; duedate: number }>;
  }>;
};

export type EvenementsCal = {
  events: Array<{
    id: number; name: string; modulename?: string; instance?: number;
    timesort: number; url?: string;
    course?: { fullname?: string; shortname?: string };
  }>;
};

/** Le sigle de cours (ex. 201-NYA-05) si le nom Moodle le porte. */
export const sigleDe = (...noms: Array<string | undefined>) => {
  for (const n of noms) {
    const m = /(\d{3}-\w{3}-\w{2})/.exec(n ?? "");
    if (m) return m[1]!;
  }
  return "";
};
