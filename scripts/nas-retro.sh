#!/usr/bin/env bash
# Enregistre la clé web RetroAchievements dans le .env du NAS. Elle est demandée ici et ne reste que là-bas.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

echo "Colle la clé web RetroAchievements, puis Entrée :" >&2
read -rs token

printf 'RETRO_API_KEY=%s\n' "$token" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^RETRO_API_KEY=/d' .env && { echo; cat; } >> .env"

echo "Enregistré sur le NAS." >&2
