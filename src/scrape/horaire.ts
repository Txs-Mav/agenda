import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { log } from "../log.js";
import { fileStore } from "../store.js";

/**
 * Lit une capture d'écran ou une photo de l'horaire Omnivox et en extrait la
 * grille de cours. Une fois par session, précision avant tout : claude-opus-5
 * (une seule image, quelques cents). La colonne des heures DOIT être visible —
 * sans elle, on refuse plutôt que de deviner.
 */
const MODEL = "claude-opus-5";

type Bloc = {
  jour: number; debut: string; fin: string; titre: string;
  type: "TH" | "LA" | "AP" | ""; sigle: string; local: string; prof: string;
};
type Extraction = { ok: boolean; raison: string; blocs: Bloc[] };

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["ok", "raison", "blocs"],
  properties: {
    ok: { type: "boolean" },
    raison: { type: "string" },
    blocs: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["jour", "debut", "fin", "titre", "type", "sigle", "local", "prof"],
        properties: {
          jour: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] },
          debut: { type: "string" }, fin: { type: "string" },
          titre: { type: "string" },
          type: { type: "string", enum: ["TH", "LA", "AP", ""] },
          sigle: { type: "string" }, local: { type: "string" }, prof: { type: "string" },
        },
      },
    },
  },
} as const;

const PROMPT = `Voici l'horaire hebdomadaire d'un étudiant de cégep (grille Omnivox ou similaire).
Extrais chaque bloc de cours. jour: 0=lundi … 6=dimanche. debut/fin au format HH:MM
(24 h), lus sur la COLONNE DES HEURES et la position verticale du bloc. titre: le nom
du cours tel qu'écrit. type: TH (théorie), LA (labo) ou AP si indiqué, sinon "".
sigle: le code de cours (ex. 201-124-RI) s'il est visible, sinon "". local et prof
s'ils sont visibles, sinon "".
Si la colonne des heures n'est PAS visible ou que l'image n'est pas un horaire,
réponds ok:false avec la raison en français, et blocs:[].`;

const MEDIA: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif",
};

function loadImage(path: string): { data: string; media: string } {
  let p = path, ext = extname(path).toLowerCase();
  if (ext === ".heic" || ext === ".heif") {
    // Photo d'iPhone : macOS sait convertir sans rien installer.
    const out = join(tmpdir(), `horaire-${Date.now()}.png`);
    execFileSync("sips", ["-s", "format", "png", path, "--out", out], { stdio: "ignore" });
    p = out; ext = ".png";
    log.info("photo HEIC convertie en PNG");
  }
  const media = MEDIA[ext];
  if (!media) throw new Error(`Format non pris en charge : ${ext}. Utilise PNG ou JPG.`);
  return { data: readFileSync(p).toString("base64"), media };
}

const toGrid = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) + ((m ?? 0) >= 30 ? 0.5 : 0);
};

export async function extractHoraire(imagePath: string): Promise<void> {
  if (!existsSync(imagePath)) throw new Error(`Fichier introuvable : ${imagePath}`);
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY manquante dans .env — l'extraction d'image en a besoin.");

  const { data, media } = loadImage(imagePath);
  log.step(`Lecture de l'horaire (${MODEL})`);

  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: media as never, data } },
        { type: "text", text: PROMPT },
      ],
    }],
  });
  if (res.stop_reason === "refusal") throw new Error("Extraction refusée par le modèle.");
  const txt = res.content.find((b) => b.type === "text");
  const out = JSON.parse(txt && "text" in txt ? txt.text : "{}") as Extraction;

  if (!out.ok) throw new Error(`Image inutilisable : ${out.raison || "raison inconnue"}`);
  if (!out.blocs.length) throw new Error("Aucun bloc de cours détecté sur l'image.");

  // Conversion vers le format de la grille : heures pleines [début, fin(
  const tt = out.blocs.map((b) => {
    const g0 = Math.floor(toGrid(b.debut));
    // (g1 borné plus bas : jamais moins d'une heure de grille)
    const g1 = Math.max(g0 + 1, Math.ceil(toGrid(b.fin)));
    return { d: b.jour, h: [g0, g1], time: `${b.debut} – ${b.fin}`,
             t: b.titre, k: b.type, code: b.sigle, room: b.local, prof: b.prof };
  }).sort((a, b) => a.d - b.d || (a.h[0] ?? 0) - (b.h[0] ?? 0));

  const payload = { source: "photo", updatedAt: new Date().toISOString(), tt };
  fileStore.write("horaire", payload);
  try { writeFileSync(join(process.cwd(), "public", "horaire.json"), JSON.stringify(payload, null, 2)); } catch {}

  log.info(`${tt.length} blocs extraits :`);
  const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
  for (const r of tt) log.info(`  ${JOURS[r.d] ?? "?"} ${r.time}  ${r.t}${r.k ? ` (${r.k})` : ""}${r.room ? ` · ${r.room}` : ""}`);
  log.info(`enregistré → ${join(config.dataDir, "horaire.json")} (+ public/horaire.json pour l'affichage local)`);
}
