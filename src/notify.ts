import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileStore } from "./store.js";
import { log } from "./log.js";

const exec = promisify(execFile);

/**
 * État de santé de la collecte planifiée. Le job passe toutes les heures sans
 * que personne ne lise `scrape.log` : sans ce fichier, une panne de session
 * reste invisible jusqu'à ce qu'une échéance soit manquée.
 */
export type Health = {
  /** Dernière collecte réussie. */
  lastOk: string | null;
  /** Dernier échec. */
  lastFail: string | null;
  /** Pourquoi ça a échoué, en clair — sert au bandeau du tableau de bord. */
  reason: string | null;
  /** `session` = il faut refaire `npm run login`. */
  kind: "session" | "autre" | null;
  /** Passages consécutifs manqués. */
  failStreak: number;
  /** Dernière alerte réellement affichée (sert à ne pas harceler). */
  notifiedAt: string | null;
};

const EMPTY: Health = {
  lastOk: null, lastFail: null, reason: null, kind: null, failStreak: 0, notifiedAt: null,
};

/** Le job passe chaque heure : sans plafond, une panne d'un week-end vaudrait
 *  48 notifications, et la 3ᵉ serait déjà ignorée. */
const RENOTIFY_H = 6;

/** Échappe pour un littéral de chaîne AppleScript. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Le dossier courant en version courte, pour tenir dans une notification. */
function shortCwd(): string {
  const home = process.env.HOME;
  const cwd = process.cwd();
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/**
 * Notification native macOS. Chemin absolu vers osascript : le PATH d'un job
 * launchd est réduit, et on ne veut pas que l'alerte disparaisse justement
 * quand elle sert. Ne lève jamais — une alerte qui casse la collecte serait
 * pire que pas d'alerte. Silencieuse hors macOS.
 */
async function notify(title: string, subtitle: string, message: string, sound: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const script =
    `display notification "${esc(message)}" with title "${esc(title)}" ` +
    `subtitle "${esc(subtitle)}" sound name "${esc(sound)}"`;
  try {
    await exec("/usr/bin/osascript", ["-e", script], { timeout: 10_000 });
    log.info("notification macOS envoyée");
  } catch (err) {
    // Cas courant : les notifications sont refusées à « Script Editor » dans
    // Réglages → Notifications. On le dit, on ne s'arrête pas.
    log.warn(`notification impossible : ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Une collecte planifiée vient d'échouer. Prévient au tout premier passage
 * manqué, puis au plus une fois toutes les `RENOTIFY_H` heures tant que la
 * panne dure.
 */
export async function reportFailure(kind: "session" | "autre", reason: string): Promise<void> {
  const prev = fileStore.read<Health>("health", EMPTY);
  const now = new Date();
  const failStreak = (prev.failStreak ?? 0) + 1;
  const sinceNotice = prev.notifiedAt
    ? (now.getTime() - new Date(prev.notifiedAt).getTime()) / 36e5
    : Infinity;
  const due = failStreak === 1 || sinceNotice >= RENOTIFY_H;

  fileStore.write("health", {
    ...prev,
    lastFail: now.toISOString(),
    reason: reason.slice(0, 300),
    kind,
    failStreak,
    notifiedAt: due ? now.toISOString() : prev.notifiedAt,
  } satisfies Health);

  if (!due) {
    log.info(`${failStreak} passages manqués — alerte déjà envoyée il y a ${sinceNotice.toFixed(1)} h`);
    return;
  }

  if (kind === "session") {
    await notify(
      "Agenda Cégep — collecte arrêtée",
      "Ta session Omnivox a expiré",
      `Dans le Terminal : cd ${shortCwd()} && npm run login`,
      "Basso",
    );
  } else {
    await notify(
      "Agenda Cégep — collecte échouée",
      `${failStreak} passage${failStreak > 1 ? "s" : ""} manqué${failStreak > 1 ? "s" : ""}`,
      `${reason.slice(0, 90)} — voir data/scrape.log`,
      "Basso",
    );
  }
}

/**
 * Collecte réussie. Ne notifie QUE si une panne avait été signalée : confirmer
 * que le `npm run login` a bien tout relancé vaut une notification, mais pas
 * vingt-quatre par jour.
 */
export async function reportSuccess(): Promise<void> {
  const prev = fileStore.read<Health>("health", EMPTY);
  const recovered = (prev.failStreak ?? 0) > 0 && !!prev.notifiedAt;
  const manques = prev.failStreak ?? 0;

  fileStore.write("health", {
    ...EMPTY,
    lastOk: new Date().toISOString(),
    lastFail: prev.lastFail,
  } satisfies Health);

  if (recovered) {
    await notify(
      "Agenda Cégep",
      "Collecte rétablie",
      `Tout est reparti après ${manques} passage${manques > 1 ? "s" : ""} manqué${manques > 1 ? "s" : ""}.`,
      "Glass",
    );
  }
}
