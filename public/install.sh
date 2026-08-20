#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
#  Agenda Cégep — installation en une commande (macOS)
#  Usage :  curl -fsSL https://agenda-five-sigma.vercel.app/install.sh | bash
#
#  Ce script ne demande JAMAIS tes identifiants : il ouvre un fichier
#  local (.env) où tu les écris toi-même, et la fenêtre de connexion
#  Omnivox où tu tapes toi-même ton code de vérification.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="$HOME/AgendaCegep"
REPO="https://github.com/Txs-Mav/agenda.git"
say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
note() { printf "   %s\n" "$*"; }

[ "$(uname)" = "Darwin" ] || { echo "Ce script est prévu pour macOS."; exit 1; }

say "1/6 · Vérification des outils"
if ! command -v git >/dev/null 2>&1; then
  note "git est absent. macOS va proposer d'installer ses outils : accepte,"
  note "puis relance cette même commande."
  xcode-select --install >/dev/null 2>&1 || true
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  note "Node.js 20+ est requis. J'ouvre la page de téléchargement —"
  note "installe-le (bouton vert), puis relance cette même commande."
  open "https://nodejs.org/fr" || true
  exit 1
fi
note "git ✓  node $(node --version) ✓"

say "2/6 · Téléchargement du programme"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only >/dev/null && note "déjà installé → mis à jour"
else
  git clone --depth 1 "$REPO" "$DIR" >/dev/null 2>&1
  note "installé dans $DIR"
fi
cd "$DIR"

say "3/6 · Installation des dépendances (1 à 2 minutes)"
npm install --silent
npx playwright install chromium >/dev/null 2>&1 || npx playwright install chromium
note "dépendances ✓"

say "4/6 · Tes identifiants Omnivox — chez toi seulement"
if [ ! -f .env ]; then cp .env.example .env; fi
note "Le fichier .env va s'ouvrir dans TextEdit. Remplace les deux"
note "REMPLACE_MOI par ton matricule et ton mot de passe, puis Cmd+S."
note "Ce fichier reste sur ton ordinateur : il n'est jamais envoyé."
open -e .env
printf "\n   Appuie sur Entrée quand c'est enregistré… "
read -r < /dev/tty

say "5/6 · Connexion à Omnivox"
note "Une fenêtre va s'ouvrir, tes identifiants déjà remplis."
note "QUAND LE CODE DE VÉRIFICATION APPARAÎT : tape-le dans la fenêtre,"
note "et coche « se souvenir de cet appareil » si c'est proposé."
npm run login

say "6/6 · Collecte automatique à chaque heure"
NPMBIN="$(command -v npm)"; NODEDIR="$(dirname "$(command -v node)")"
PLIST="$HOME/Library/LaunchAgents/ca.qc.cegeptr.agenda.scrape.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ca.qc.cegeptr.agenda.scrape</string>
  <key>ProgramArguments</key><array><string>$NPMBIN</string><string>run</string><string>scrape</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODEDIR:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$DIR/data/scrape.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/scrape.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/ca.qc.cegeptr.agenda.scrape" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
note "collecte horaire installée ✓"

say "Première collecte…"
npm run scrape || true

say "Terminé 🎉"
note "Ton tableau de bord : https://agenda-five-sigma.vercel.app"
note "Pour tes données à toi : crée un compte via « Connexion » dans l'app,"
note "confirme le courriel, puis ajoute AGENDA_EMAIL et AGENDA_PASSWORD"
note "dans $DIR/.env — la prochaine collecte les enverra sous ton compte."
