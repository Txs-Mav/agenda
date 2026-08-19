/**
 * Un seul endroit responsable de masquer les secrets. Tout ce qui sort du
 * programme (logs, erreurs, messages) passe par ici. Les valeurs à masquer
 * sont enregistrées au démarrage par config.ts.
 */
const secrets = new Set<string>();

/** Enregistre une valeur à masquer partout. Ignore les valeurs trop courtes. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 4) secrets.add(value);
}

const PATTERNS: Array<[RegExp, string]> = [
  // Cookies de session ASP.NET / Omnivox
  [/(ASP\.NET_SessionId|\.ASPXAUTH|OMNIVOX[A-Z_]*)=[^;\s"']+/gi, "$1=***"],
  // Le nonce anti-rejeu du formulaire de login
  [/(["'&?]k=)[0-9]{8,}/g, "$1***"],
  // En-têtes d'autorisation
  [/(authorization:\s*\w+\s+)\S+/gi, "$1***"],
];

/** Masque tout secret connu et tout motif sensible dans une chaîne. */
export function redact(input: unknown): string {
  let out = typeof input === "string" ? input : safeStringify(input);
  for (const s of secrets) out = out.split(s).join("***");
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  try {
    return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}
