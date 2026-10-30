#!/usr/bin/env bash
# Met à jour le site sur le NAS depuis le dépôt local : envoie le code, reconstruit, redémarre.
# Le fichier .env, les sauvegardes et la base du NAS ne sont jamais touchés.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

REF="${1:-HEAD}"

cd "$(dirname "$0")/.."

if [ "$REF" = HEAD ] && [ -n "$(git status --porcelain)" ]; then
  echo "Le dépôt contient des modifications non commitées : déploiement annulé." >&2
  exit 1
fi

nas() {
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ServerAliveInterval=30 "$HOST" "$@"
}

# QTS n'offre pas de dossier personnel utilisable par Docker Compose en SSH.
compose=". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; cd $DIR; docker compose -f docker-compose.nas.yml --profile tunnel"

echo "Envoi de $(git rev-parse --short "$REF")…"
git archive "$REF" | nas "tar -xf - -C $DIR"

echo "Construction de l'image, plusieurs minutes…"
nas "$compose build site"

echo "Redémarrage…"
# Un premier essai peut échouer sur une règle réseau de QTS : le second suffit.
nas "$compose up -d || $compose up -d"

echo "Vérification…"
nas "n=0; until curl -fs -o /dev/null http://127.0.0.1:3100/ || [ \$n -ge 60 ]; do sleep 2; n=\$((n+1)); done
curl -fs -o /dev/null http://127.0.0.1:3100/ && echo 'Site en ligne.' || { echo 'Le site ne répond pas.' >&2; exit 1; }"
