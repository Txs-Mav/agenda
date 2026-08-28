/** `npm run moodle` — un passage à la main. La version embarquée tourne
 *  d'elle-même à chaque collecte horaire dès que le jeton existe. */
import { collecteMoodle } from "./collect.js";
import { MoodleError } from "./api.js";
import { log } from "../log.js";

try {
  await collecteMoodle();
} catch (err) {
  log.error(err instanceof Error ? err.message : err);
  process.exit(err instanceof MoodleError && err.code === "aucunjeton" ? 2 : 1);
}
