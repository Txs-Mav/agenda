import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { registerSecret } from "./redact.js";

/** Charge .env sans dépendance externe. Les vraies variables d'environnement
 *  (Railway) ont priorité: on n'écrase jamais ce qui est déjà défini. */
function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Variable d'environnement manquante: ${key}. ` +
        `Copie .env.example vers .env et remplis-la (ou définis-la dans les Variables Railway).`,
    );
  }
  return v;
}

loadDotEnv();

const dataDir = resolve(process.env.DATA_DIR || "./data");

export const config = {
  host: process.env.OMNIVOX_HOST || "cegeptr.omnivox.ca",
  /** Lus paresseusement: `check` doit pouvoir tourner sur une session existante
   *  sans que les identifiants soient présents. */
  get user() {
    return required("OMNIVOX_USER");
  },
  get pass() {
    return required("OMNIVOX_PASS");
  },
  hasCredentials: Boolean(process.env.OMNIVOX_USER && process.env.OMNIVOX_PASS),
  headed: process.env.HEADED === "true",
  dataDir,
  statePath: join(dataDir, "storage-state.json"),
  runsDir: join(dataDir, "runs"),
} as const;

export const urls = {
  root: `https://${config.host}/`,
  login: `https://${config.host}/Login/Account/Login?ReturnUrl=%2fintr%2f`,
  intranet: `https://${config.host}/intr/`,
};

// Enregistré dès le chargement pour que rien ne puisse fuir dans un log.
registerSecret(process.env.OMNIVOX_USER);
registerSecret(process.env.OMNIVOX_PASS);
