import { redact } from "./redact.js";

/**
 * N'appelle jamais console.* directement ailleurs dans le projet : ce module
 * est la seule sortie, et il redacte systématiquement.
 */
const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...parts: unknown[]) => console.log(`${stamp()}  ${parts.map(redact).join(" ")}`),
  warn: (...parts: unknown[]) => console.warn(`${stamp()}  ⚠ ${parts.map(redact).join(" ")}`),
  error: (...parts: unknown[]) => console.error(`${stamp()}  ✖ ${parts.map(redact).join(" ")}`),
  step: (msg: string) => console.log(`\n▸ ${redact(msg)}`),
};
