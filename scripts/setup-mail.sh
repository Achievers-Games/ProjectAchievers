#!/usr/bin/env bash
# Configure les variables SMTP dans .env pour l'envoi d'email depuis contact@achievers.games.
# Usage : bash scripts/setup-mail.sh <smtp-host> <smtp-port> <smtp-user> <smtp-pass>
# Exemple (Gmail)   : bash scripts/setup-mail.sh smtp.gmail.com 587 achievers.query@gmail.com <app-password>
# Exemple (Resend)  : bash scripts/setup-mail.sh smtp.resend.com 587 resend <api-key>
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage : $0 <smtp-host> <smtp-port> <smtp-user> <smtp-pass>"
  echo ""
  echo "Exemples :"
  echo "  $0 smtp.gmail.com      587 achievers.query@gmail.com <app-password-google>"
  echo "  $0 smtp.resend.com     587 resend                   <cle-api-resend>"
  exit 1
fi

HOST="$1"
PORT="$2"
USER="$3"
PASS="$4"
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.example" ]; then
    echo "Copie .env.example vers .env..."
    cp .env.example "$ENV_FILE"
  else
    echo "Aucun .env.example trouvé, création d'un fichier vide."
    touch "$ENV_FILE"
  fi
fi

# Supprime les anciennes lignes SMTP si elles existent
grep -v -E '^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM|SMTP_FROM_NAME)=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
mv "$ENV_FILE.tmp" "$ENV_FILE"

cat >> "$ENV_FILE" <<EOF

# Configuration SMTP - envoi d'email depuis contact@achievers.games
SMTP_HOST="$HOST"
SMTP_PORT="$PORT"
SMTP_USER="$USER"
SMTP_PASS="$PASS"
SMTP_FROM="contact@achievers.games"
SMTP_FROM_NAME="Project Achievers"
EOF

echo "✅ Variables SMTP ajoutées à .env :"
echo "   SMTP_HOST=$HOST"
echo "   SMTP_PORT=$PORT"
echo "   SMTP_USER=$USER"
echo "   SMTP_FROM=contact@achievers.games"
echo ""
echo "⚠️  Rappel : tu dois aussi ajouter SMTP à src/lib/server/env.ts si tu veux que le serveur les valide."
