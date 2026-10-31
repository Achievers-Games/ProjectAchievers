#!/usr/bin/env bash
# Autorise le NAS à télécharger l'image privée. Le jeton est demandé ici et ne reste que sur le NAS.
set -euo pipefail

HOST="${NAS_HOST:-BasicRem@192.168.1.162}"
KEY="${NAS_KEY:-$HOME/.ssh/pa_nas}"
DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

# `read -p` n'affiche rien quand Git Bash est lancé depuis PowerShell.
echo "Colle le jeton GitHub (droit read:packages), puis Entrée :" >&2
read -rs token

printf '%s' "$token" | ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" \
  ". /etc/profile; export HOME=/share/homes/\${USER:-BasicRem} DOCKER_CONFIG=$DIR/.docker; docker login ghcr.io -u RBasic --password-stdin"
