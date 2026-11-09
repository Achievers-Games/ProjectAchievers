#!/usr/bin/env bash
# Enregistre la clé de l'API Lure (lure_pk_…) dans le .env du NAS, puis redémarre le site.
# Avec elle, Achievers demande à Lure, à chaque connexion, quel compte Lure porte les mêmes
# identités (Steam, Discord…) et relie les deux comptes tout seul.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"
URL="${LURE_API_URL:-https://lureverse.fr}"

echo "Clé de l'API Lure (lure_pk_…, rien ne s'affiche), puis Entrée :" >&2
read -rs key
echo >&2
key="$(printf '%s' "$key" | tr -d '[:space:]')"

if [[ "$key" != lure_pk_* ]]; then
  echo "Ce n'est pas une clé Lure : elle doit commencer par lure_pk_. Rien n'a été changé." >&2
  exit 1
fi

# Un essai avant d'enregistrer : une identité fictive, Lure doit répondre 200 et une liste vide.
echo "Vérification de la clé auprès de $URL…" >&2
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$URL/api/v1/partner/identities/lookup" \
  -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
  -d '{"identities":[{"provider":"STEAM","providerUserId":"76561190000000000"}]}' || true)
case "$status" in
  200) echo "Clé acceptée par Lure." >&2 ;;
  401)
    echo "Lure refuse cette clé (401). Vérifie-la avec le développeur de Lure. Rien n'a été changé." >&2
    exit 1
    ;;
  *)
    echo "Lure ne répond pas normalement (statut $status). Rien n'a été changé." >&2
    exit 1
    ;;
esac

cd "$(dirname "$0")/.."

# Le fichier compose transmet LURE_API_URL et LURE_API_KEY au site : il part avec la clé, sans
# attendre le prochain déploiement complet.
ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
  "cat > $DIR/docker-compose.nas.yml" < docker-compose.nas.yml

# La clé passe par l'entrée de ssh, jamais par la ligne de commande : elle n'apparaît nulle part.
printf 'LURE_API_URL="%s"\nLURE_API_KEY="%s"\n' "$URL" "$key" |
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
    "cd $DIR && sed -i '/^LURE_API_\(URL\|KEY\)=/d' .env && { echo; cat; } >> .env"

ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
  ". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; cd $DIR
  export SITE_IMAGE=\$(docker inspect -f '{{.Config.Image}}' project-achievers-site-1)
  docker compose -f docker-compose.nas.yml --profile tunnel up -d --no-build site"

echo "Clé Lure enregistrée sur le NAS, le site a redémarré." >&2
