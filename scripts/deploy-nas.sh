#!/usr/bin/env bash
# Met à jour le site sur le NAS avec l'image publiée par la CI pour ce commit.
# NAS_BUILD=1 reconstruit sur le NAS : pour du code non commité, ou si GitHub est indisponible.
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

SSH=(ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ServerAliveInterval=30)
# Hors du réseau local : NAS_HOST=BasicRem@ssh.achievers.games passe par le tunnel Cloudflare.
if [[ "$HOST" == *ssh.achievers.games ]]; then
  SSH+=(-o "ProxyCommand=cloudflared access ssh --hostname %h")
fi

nas() {
  "${SSH[@]}" "$HOST" "$@"
}

# QTS n'offre pas de dossier personnel utilisable par Docker Compose en SSH.
IMAGE="ghcr.io/achievers-games/projectachievers:$(git rev-parse "$REF")"
[ -z "${NAS_BUILD:-}" ] || IMAGE=project-achievers-site:local

compose=". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker SITE_IMAGE=$IMAGE; cd $DIR; docker compose -f docker-compose.nas.yml --profile tunnel"

echo "Envoi de $(git rev-parse --short "$REF")…"
git archive "$REF" | nas "tar -xf - -C $DIR"

if [ -n "${NAS_BUILD:-}" ]; then
  echo "Construction de l'image, plusieurs minutes…"
  # L'écriture du build échoue parfois sur le NAS (ENOENT sur mkdir) : un second essai suffit.
  nas "$compose build site" || nas "$compose build site"
else
  echo "Téléchargement de $IMAGE…"
  # La CI peut encore tourner : l'image n'est publiée qu'une fois les tests passés.
  until nas "$compose pull site"; do
    n=$((${n:-0} + 1))
    [ "$n" -lt 60 ] || { echo "Image introuvable après 20 minutes." >&2; exit 1; }
    sleep 20
  done
fi

echo "Redémarrage…"
# Le déploiement automatique recrée le site dès qu'il voit la nouvelle image : s'il le fait au même
# instant que ce script, Docker refuse le nom du conteneur et le site reste arrêté (13 novembre).
# Il est donc mis en pause le temps du redémarrage ; `up` le relance avec le reste.
nas "$compose stop deployer" || true
# Un premier essai peut échouer sur une règle réseau de QTS : le second suffit.
if [[ "$HOST" == *ssh.achievers.games ]]; then
  # Par le tunnel, ce redémarrage coupe la connexion qui le commande : lancé tel quel, il
  # s'arrêtait en route et laissait le site et le tunnel éteints (14 novembre). Il tourne donc
  # détaché sur le NAS, et la vérification attend que le tunnel revienne.
  nas "nohup sh -c '$compose up -d --no-build || $compose up -d --no-build' > $DIR/.deploy.log 2>&1 &"
  echo "Redémarrage lancé sur le NAS, attente du retour du tunnel…"
  for _ in $(seq 1 40); do
    sleep 6
    nas true 2> /dev/null && break
  done
else
  nas "$compose up -d --no-build || $compose up -d --no-build"
fi

echo "Vérification…"
nas "n=0; until curl -fs -o /dev/null http://127.0.0.1:3100/ || [ \$n -ge 60 ]; do sleep 2; n=\$((n+1)); done
curl -fs -o /dev/null http://127.0.0.1:3100/ && echo 'Site en ligne.' || { echo 'Le site ne répond pas.' >&2; exit 1; }"
