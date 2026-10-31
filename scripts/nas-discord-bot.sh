#!/usr/bin/env bash
# Enregistre le jeton du bot Discord dans le .env du NAS. Il est demandé ici et ne reste que là-bas.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

echo "Colle le jeton du bot Discord, puis Entrée :" >&2
read -rs token

printf 'DISCORD_BOT_TOKEN=%s\n' "$token" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^DISCORD_BOT_TOKEN=/d' .env && { echo; cat; } >> .env"

echo "Enregistré sur le NAS." >&2
