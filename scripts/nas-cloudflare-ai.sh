#!/usr/bin/env bash
# Enregistre l'accès à Workers AI dans le .env du NAS. Le jeton est demandé ici et ne reste que là-bas.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

echo "Colle l'identifiant du compte Cloudflare, puis Entrée :" >&2
read -r account
echo "Colle le jeton Workers AI, puis Entrée :" >&2
read -rs token

printf 'CLOUDFLARE_ACCOUNT_ID=%s\nCLOUDFLARE_AI_TOKEN=%s\n' "$account" "$token" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^CLOUDFLARE_\(ACCOUNT_ID\|AI_TOKEN\)=/d' .env && { echo; cat; } >> .env"

echo "Enregistré sur le NAS." >&2
