#!/usr/bin/env bash
# Génère les clés des notifications et les enregistre dans le .env du NAS, sans les afficher.
# Ne pas relancer sans raison : changer les clés coupe tous les abonnements existants.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"
CONTACT="${1:?Indique une adresse de contact : scripts/nas-push.sh mailto:toi@exemple.fr}"

cd "$(dirname "$0")/.."

node -e "
  const { generateVAPIDKeys } = require('web-push');
  const { publicKey, privateKey } = generateVAPIDKeys();
  console.log('VAPID_PUBLIC_KEY=' + publicKey);
  console.log('VAPID_PRIVATE_KEY=' + privateKey);
  console.log('VAPID_CONTACT=' + process.argv[1]);
" "$CONTACT" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^VAPID_/d' .env && { echo; cat; } >> .env"

echo "Enregistré sur le NAS." >&2
