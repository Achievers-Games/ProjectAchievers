#!/usr/bin/env bash
# Envoie sur le NAS les cartes publiées dans ./cards (`node scripts/publish-cards.mjs`). Seules
# les versions absentes du NAS partent : une version publiée n'y est jamais réécrite, le cache de
# Cloudflare la garde un an. Le site les sert aussitôt, sans build ni redémarrage.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"
CARDS="${NAS_CARDS_DIR:-$DIR/cartes}"

cd "$(dirname "$0")/.."
[ -d cards ] || { echo "Rien à envoyer : lance d'abord node scripts/publish-cards.mjs." >&2; exit 1; }

SSH=(ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ServerAliveInterval=30)
# Hors du réseau local : NAS_HOST=BasicRem@ssh.achievers.games passe par le tunnel Cloudflare.
if [[ "$HOST" == *ssh.achievers.games ]]; then
  SSH+=(-o "ProxyCommand=cloudflared access ssh --hostname %h")
fi
nas() {
  "${SSH[@]}" "$HOST" "$@"
}

# Les versions déjà sur le NAS, sous la forme « dossier/version ».
remote=$(nas "mkdir -p $CARDS && cd $CARDS && find . -mindepth 2 -maxdepth 2 -type d | sed 's|^\./||'")
missing=()
for path in cards/*/*/; do
  version="${path#cards/}"
  version="${version%/}"
  grep -qxF "$version" <<< "$remote" || missing+=("$version")
done

if [ ${#missing[@]} -eq 0 ]; then
  echo "Le NAS a déjà toutes les cartes publiées."
  exit 0
fi
printf 'Envoi de %s\n' "${missing[@]}"
tar -C cards -cf - "${missing[@]}" | nas "tar -xf - -C $CARDS"
echo "${#missing[@]} version(s) envoyée(s)."
