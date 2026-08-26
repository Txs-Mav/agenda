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
  src: "mio" | "lea" | "manuel" | "moodle";
  code: string;   // sigle du cours, ex. 320-123-RI — sert à retrouver la teinte
  done: boolean;
};

/**
 * Une action d'agenda proposée par l'agent à partir d'un MIO. L'interface les
 * applique automatiquement (échéance, tâche, bloc d'horaire) et retient par
 * `id` ce qui a déjà été appliqué : supprimer un élément est définitif.
 */
export type MioAction = {
  id: string;
  type: "echeance" | "tache" | "bloc" | "reporter" | "annuler";
  t: string;
  kind?: Deadline["kind"]; // echeance
  date?: string;           // echeance, bloc, reporter — AAAA-MM-JJ
  time?: string;           // echeance, reporter — HH:MM ou ""
  from?: number;           // bloc — heure entière de début
  to?: number;             // bloc — heure entière de fin
  target?: string;         // reporter, annuler — id de l'échéance visée
  code?: string;           // sigle du cours s'il apparaît dans le message
  course?: string;         // nom du cours si identifiable
};

/** Un MIO résumé tel que l'interface l'attend. */
export type Mio = {
  id: string;
  from: string;
  course: string;
  date: string;
  subject: string;
  summary: string;
  actions?: MioAction[];   // propositions de l'agent (souvent vide, et c'est correct)
};
