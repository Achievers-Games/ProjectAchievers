#!/usr/bin/env bash
# Enregistre le jeton d'API Cloudflare (WAF, robots) dans le .env du NAS, puis vérifie qu'il voit la
# zone. Le jeton est demandé ici, passe par l'entrée de SSH et ne reste que là-bas.
# Usage : bash scripts/nas-cloudflare-api.sh
set -euo pipefail

DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"

# Par défaut, le tunnel Cloudflare (`nas-achievers` dans ~/.ssh/config) : marche hors de la maison.
if [ -n "${NAS_HOST:-}" ]; then
  SSH=(ssh -i "${NAS_KEY:-$HOME/.ssh/pa_nas}" -o IdentitiesOnly=yes "$NAS_HOST")
else
  SSH=(ssh nas-achievers)
fi

echo "Colle le jeton Cloudflare, puis Entrée (rien ne s'affiche, c'est normal) :" >&2
read -rs token
echo >&2
token="${token//[[:space:]]/}"
if [ "${#token}" -lt 30 ]; then
  echo "Jeton de ${#token} caractères : trop court, rien n'est enregistré." >&2
  exit 1
fi
echo "Jeton de ${#token} caractères, envoi au NAS…" >&2

# Première ligne : le jeton, lu par `read` ; le reste : le script exécuté sur le NAS.
{
  printf '%s\n' "$token"
  cat <<EOF
cd '$DIR' || exit 1
sed -i '/^CLOUDFLARE_API_TOKEN=/d' .env
printf '\nCLOUDFLARE_API_TOKEN=%s\n' "\$t" >> .env
echo "Enregistré sur le NAS."
api() { curl -s -H "Authorization: Bearer \$t" "https://api.cloudflare.com/client/v4/\$1"; }
# Un jeton de compte ne se vérifie que sous son compte, un jeton d'utilisateur sous /user.
a=\$(grep '^CLOUDFLARE_ACCOUNT_ID=' .env | tail -1 | cut -d= -f2-)
if { api user/tokens/verify; api "accounts/\$a/tokens/verify"; } | grep -q '"status":"active"'; then echo "  jeton actif"; else echo "  jeton refusé par Cloudflare"; fi
if api 'zones?name=achievers.games' | grep -q '"name":"achievers.games"'; then
  echo "  zone achievers.games visible : c'est bon"
else
  echo "  zone achievers.games invisible : il manque les droits Zone sur le jeton"
fi
EOF
} | "${SSH[@]}" 'read -r t; export t; sh -s'
