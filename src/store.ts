import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

/**
 * Interface de stockage. FileStore suffit tant que scraper et lecteur vivent
 * dans le même service ; le jour où tu les sépares sur Railway (un volume ne se
 * monte que sur un service), il suffit d'écrire un SupabaseStore ici.
 */
export type Store = {
  read<T>(name: string, fallback: T): T;
  write(name: string, value: unknown): void;
};

export const fileStore: Store = {
  read(name, fallback) {
    const p = join(config.dataDir, `${name}.json`);
    if (!existsSync(p)) return fallback;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return fallback;
    }
  },
  write(name, value) {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(join(config.dataDir, `${name}.json`), JSON.stringify(value, null, 2));
  },
};

/** Une échéance telle que l'interface l'attend. */
export type Deadline = {
  id: string;
  t: string;
  course: string;
  date: string;   // AAAA-MM-JJ
  time: string;   // HH:MM ou ""
  kind: "examen" | "remise" | "autre";
  src: "mio" | "lea" | "manuel";
  done: boolean;
};

/** Un MIO résumé tel que l'interface l'attend. */
export type Mio = {
  id: string;
  from: string;
  course: string;
  date: string;
  subject: string;
  summary: string;
  add: { t: string; date: string; time: string; kind: Deadline["kind"] } | null;
};
