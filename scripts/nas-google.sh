#!/usr/bin/env bash
# Enregistre l'identifiant et le secret du client OAuth Google (connexion au site) dans le .env du
# NAS, puis redémarre le site. Ils sont demandés ici et ne restent que sur le NAS.
# Redirection à déclarer sur le client : https://achievers.games/auth/google/callback
#
# Par défaut, la connexion passe par le tunnel Cloudflare (ssh.achievers.games, avec cloudflared
# installé sur ce poste) : le script fonctionne aussi hors du réseau local.
# Sur le réseau local, sans tunnel : NAS_HOST=BasicRem@192.168.1.162 bash scripts/nas-google.sh
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@ssh.achievers.games}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

SSH=(ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=30)
if [[ "$HOST" == *ssh.achievers.games ]]; then
  command -v cloudflared > /dev/null || {
    echo "cloudflared est introuvable : installe-le, ou passe par le réseau local avec NAS_HOST." >&2
    exit 1
  }
  SSH+=(-o "ProxyCommand=cloudflared access ssh --hostname %h")
fi
nas() { "${SSH[@]}" "$HOST" "$@"; }

echo "Colle l'ID client Google (…apps.googleusercontent.com), puis Entrée :" >&2
read -r id
echo "Colle le code secret du client, puis Entrée (rien ne s'affiche) :" >&2
read -rs secret
echo >&2
id="$(printf '%s' "$id" | tr -d '[:space:]')"
secret="$(printf '%s' "$secret" | tr -d '[:space:]')"

if [[ ! "$id" =~ ^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$ ]]; then
  echo "Ce n'est pas un ID client Google. Rien n'a été changé." >&2
  exit 1
fi
if [[ -z "$secret" ]]; then
  echo "Le secret est vide. Rien n'a été changé." >&2
  exit 1
fi

# Un essai avant d'enregistrer : avec un faux code, Google répond invalid_grant si le client est
# reconnu, invalid_client sinon. Le secret passe par l'entrée de curl, pas par sa ligne de commande.
echo "Vérification du client auprès de Google…" >&2
answer=$(printf 'data = "grant_type=authorization_code&code=essai&redirect_uri=https://achievers.games/auth/google/callback&client_id=%s&client_secret=%s"\n' "$id" "$secret" |
  curl -s --max-time 15 -K - https://oauth2.googleapis.com/token || true)
case "$answer" in
  *invalid_grant*) echo "Client accepté par Google." >&2 ;;
  *invalid_client* | *unauthorized_client*)
    echo "Google refuse ce client : vérifie l'ID et le secret. Rien n'a été changé." >&2
    exit 1
    ;;
  *)
    echo "Réponse inattendue de Google, rien n'a été changé : $answer" >&2
    exit 1
    ;;
esac

printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$id" "$secret" |
  nas "cd $DIR && cp .env .env.avant-google && sed -i '/^GOOGLE_CLIENT_/d' .env && { echo; cat; } >> .env"

# Le site ne lit son .env qu'au démarrage : il est recréé sur la même image, sans rien déployer.
nas ". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; cd $DIR
  export SITE_IMAGE=\$(docker inspect -f '{{.Config.Image}}' project-achievers-site-1)
  docker compose -f docker-compose.nas.yml --profile tunnel up -d --no-build site"

echo "Vérification…" >&2
nas "n=0; until curl -fs -o /dev/null http://127.0.0.1:3100/api/health || [ \$n -ge 60 ]; do sleep 2; n=\$((n+1)); done
curl -fs -o /dev/null http://127.0.0.1:3100/api/health" &&
  echo "Client Google enregistré sur le NAS, le site a redémarré. L'ancien .env est dans .env.avant-google." >&2 ||
  { echo "Le client est enregistré, mais le site ne répond pas : regarde ses logs." >&2; exit 1; }
