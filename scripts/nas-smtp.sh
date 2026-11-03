#!/usr/bin/env bash
# Enregistre la configuration SMTP dans le .env du NAS, puis redémarre le site.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

echo "Serveur SMTP (ex: smtp.gmail.com), puis Entrée :" >&2
read -r host
echo "Port (ex: 587), puis Entrée :" >&2
read -r port
echo "Utilisateur SMTP (ex: contact@achievers.games), puis Entrée :" >&2
read -r user
echo "Mot de passe / clé API (rien ne s'affiche), puis Entrée :" >&2
read -rs pass

printf 'SMTP_HOST="%s"\nSMTP_PORT=%s\nSMTP_USER="%s"\nSMTP_PASS="%s"\nSMTP_FROM="contact@achievers.games"\nSMTP_FROM_NAME="Project Achievers"\n' "$host" "$port" "$user" "$pass" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^SMTP_\(HOST\|PORT\|USER\|PASS\|FROM\|FROM_NAME\)=/d' .env && { echo; cat; } >> .env"

ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
  ". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; cd $DIR
  export SITE_IMAGE=\$(docker inspect -f '{{.Config.Image}}' project-achievers-site-1)
  docker compose -f docker-compose.nas.yml --profile tunnel up -d --no-build site"

echo "SMTP enregistré sur le NAS, le site a redémarré." >&2
