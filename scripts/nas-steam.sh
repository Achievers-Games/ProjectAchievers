#!/usr/bin/env bash
# Enregistre la clé de l'API web Steam dans le .env du NAS, puis redémarre le site.
# La clé se crée sur https://steamcommunity.com/dev/apikey ; elle est demandée ici et ne reste
# que sur le NAS.
#
# Par défaut, la connexion passe par le tunnel Cloudflare (ssh.achievers.games, avec cloudflared
# installé sur ce poste) : le script fonctionne aussi hors du réseau local.
# Sur le réseau local, sans tunnel : NAS_HOST=BasicRem@192.168.1.162 bash scripts/nas-steam.sh
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

echo "Clé de l'API web Steam (32 caractères, rien ne s'affiche), puis Entrée :" >&2
read -rs key
echo >&2
key="$(printf '%s' "$key" | tr -d '[:space:]')"

if [[ ! "$key" =~ ^[0-9A-Fa-f]{32}$ ]]; then
  echo "Ce n'est pas une clé Steam : 32 caractères hexadécimaux attendus. Rien n'a été changé." >&2
  exit 1
fi

# Un essai avant d'enregistrer : Steam répond 403 à une clé inconnue ou révoquée. La clé passe par
# l'entrée de curl, pas par sa ligne de commande, où les autres programmes du poste la liraient.
echo "Vérification de la clé auprès de Steam…" >&2
status=$(printf 'url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=%s&steamids=76561197960435530"\n' "$key" |
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 -K - || true)
case "$status" in
  200) echo "Clé acceptée par Steam." >&2 ;;
  403)
    echo "Steam refuse cette clé (403). Vérifie-la sur steamcommunity.com/dev/apikey. Rien n'a été changé." >&2
    exit 1
    ;;
  *)
    echo "Steam ne répond pas normalement (statut $status). Rien n'a été changé." >&2
    exit 1
    ;;
esac

# La clé passe par l'entrée de ssh, jamais par la ligne de commande : elle n'apparaît nulle part.
printf 'STEAM_API_KEY=%s\n' "$key" |
  nas "cd $DIR && sed -i '/^STEAM_API_KEY=/d' .env && { echo; cat; } >> .env"

# Le site ne lit son .env qu'au démarrage : il est recréé sur la même image, sans rien déployer.
nas ". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; cd $DIR
  export SITE_IMAGE=\$(docker inspect -f '{{.Config.Image}}' project-achievers-site-1)
  docker compose -f docker-compose.nas.yml --profile tunnel up -d --no-build site"

echo "Vérification…" >&2
nas "n=0; until curl -fs -o /dev/null http://127.0.0.1:3100/api/health || [ \$n -ge 60 ]; do sleep 2; n=\$((n+1)); done
curl -fs -o /dev/null http://127.0.0.1:3100/api/health" &&
  echo "Clé Steam enregistrée sur le NAS, le site a redémarré." >&2 ||
  { echo "La clé est enregistrée, mais le site ne répond pas : regarde ses logs." >&2; exit 1; }
