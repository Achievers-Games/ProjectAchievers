#!/usr/bin/env bash
# Enregistre l'identifiant et le secret du client Epic dans le .env du NAS. Ils ne restent que là-bas.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

echo "Colle le Client ID Epic, puis Entrée :" >&2
read -r id
echo "Colle le Client Secret Epic, puis Entrée (rien ne s'affiche) :" >&2
read -rs secret

printf 'EPIC_CLIENT_ID=%s\nEPIC_CLIENT_SECRET=%s\n' "$id" "$secret" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^EPIC_CLIENT_/d' .env && { echo; cat; } >> .env"

echo "Enregistré sur le NAS." >&2
