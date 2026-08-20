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

/** Valeurs de .env.example et autres placeholders évidents. Les soumettre à
 *  Omnivox serait une tentative de connexion ratée — donc un pas vers le
 *  captcha armé et le verrouillage du DA. On les traite comme "absent". */
const PLACEHOLDERS = new Set([
  "REMPLACE_MOI",
  "1234567",
  "0000000",
  "motdepasse-bidon-remplace-moi",
  "changeme",
  "xxx",
]);

const isPlaceholder = (v: string | undefined): boolean =>
  !v || v.trim() === "" || PLACEHOLDERS.has(v.trim().toLowerCase()) || PLACEHOLDERS.has(v.trim());

const credsUsable =
  !isPlaceholder(process.env.OMNIVOX_USER) && !isPlaceholder(process.env.OMNIVOX_PASS);

const dataDir = resolve(process.env.DATA_DIR || "./data");

export const config = {
  host: process.env.OMNIVOX_HOST || "cegeptr.omnivox.ca",
  /** Lus paresseusement: `check` doit pouvoir tourner sur une session existante
   *  sans que les identifiants soient présents. */
  get user() {
    const v = required("OMNIVOX_USER");
    if (isPlaceholder(v)) throw new Error(PLACEHOLDER_MSG);
    return v;
  },
  get pass() {
    const v = required("OMNIVOX_PASS");
    if (isPlaceholder(v)) throw new Error(PLACEHOLDER_MSG);
    return v;
  },
  hasCredentials: credsUsable,
  headed: process.env.HEADED === "true",
  dataDir,
  statePath: join(dataDir, "storage-state.json"),
  runsDir: join(dataDir, "runs"),
} as const;

export const PLACEHOLDER_MSG =
  "Le .env contient encore les valeurs d'exemple. Ouvre " +
  `${resolve(process.cwd(), ".env")} et remplis OMNIVOX_USER / OMNIVOX_PASS ` +
  "avec tes vrais identifiants. Aucune connexion n'a été tentée.";

export const urls = {
  root: `https://${config.host}/`,
  login: `https://${config.host}/Login/Account/Login?ReturnUrl=%2fintr%2f`,
  intranet: `https://${config.host}/intr/`,
  mio: `https://${config.host}/WebApplication/Module.MIOE/Default.aspx?Provenance=INTR`,
};

// Enregistré dès le chargement pour que rien ne puisse fuir dans un log.
registerSecret(process.env.OMNIVOX_USER);
registerSecret(process.env.OMNIVOX_PASS);
