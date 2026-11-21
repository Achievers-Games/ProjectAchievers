#!/usr/bin/env bash
# Sauvegarde sur le NAS les fichiers de fabrication des cartes, que git ignore : masters .ora,
# images d'origine (source.*), dossiers work/ et essais. Ce sont les fichiers ignorés sous
# static/_proto ; sans eux, une carte ne se retouche plus.
#
#   bash scripts/nas-card-sources.sh push   # envoie tout l'atelier local vers le NAS
#   bash scripts/nas-card-sources.sh pull   # récupère ce qui manque ou est plus récent sur le NAS
#   bash scripts/nas-card-sources.sh list   # ce qui est sur le NAS
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"
SOURCES="${NAS_CARD_SOURCES_DIR:-$DIR/cartes-sources}"
WORKSHOP=static/_proto

cd "$(dirname "$0")/.."

SSH=(ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ServerAliveInterval=30)
# Hors du réseau local : NAS_HOST=BasicRem@ssh.achievers.games passe par le tunnel Cloudflare.
if [[ "$HOST" == *ssh.achievers.games ]]; then
  SSH+=(-o "ProxyCommand=cloudflared access ssh --hostname %h")
fi
nas() {
  "${SSH[@]}" "$HOST" "$@"
}

case "${1:-}" in
  push)
    # Les fichiers ignorés par git sous l'atelier, en chemins relatifs à l'atelier.
    mapfile -t files < <(git ls-files --others --ignored --exclude-standard -- "$WORKSHOP" | sed "s|^$WORKSHOP/||")
    if [ ${#files[@]} -eq 0 ]; then
      echo "Aucun fichier de fabrication dans $WORKSHOP."
      exit 0
    fi
    printf '%s\n' "${files[@]}" | tar -C "$WORKSHOP" -cf - -T - | nas "mkdir -p $SOURCES && tar -xf - -C $SOURCES"
    echo "${#files[@]} fichier(s) sauvegardé(s) dans $SOURCES."
    ;;
  pull)
    # Un fichier local plus récent n'est jamais écrasé.
    nas "cd $SOURCES && tar -cf - ." | tar -C "$WORKSHOP" --keep-newer-files -xf -
    echo "Sources récupérées dans $WORKSHOP."
    ;;
  list)
    nas "cd $SOURCES && find . -type f | sed 's|^\./||' | sort"
    ;;
  *)
    echo "Usage : bash scripts/nas-card-sources.sh push|pull|list" >&2
    exit 1
    ;;
esac
