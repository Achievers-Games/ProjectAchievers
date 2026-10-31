#!/usr/bin/env bash
# Enregistre l'application Microsoft dans le .env du NAS, puis redémarre le site avec son image actuelle.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

echo "Colle l'identifiant de l'application (client), puis Entrée :" >&2
read -r client
echo "Colle la valeur du secret, puis Entrée :" >&2
read -rs secret

printf 'XBOX_CLIENT_ID=%s\nXBOX_CLIENT_SECRET=%s\n' "$client" "$secret" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^XBOX_CLIENT_\(ID\|SECRET\)=/d' .env && { echo; cat; } >> .env"

ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
  ". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; cd $DIR
  export SITE_IMAGE=\$(docker inspect -f '{{.Config.Image}}' project-achievers-site-1)
  docker compose -f docker-compose.nas.yml --profile tunnel up -d --no-build site"

echo "Enregistré, le site a redémarré." >&2
