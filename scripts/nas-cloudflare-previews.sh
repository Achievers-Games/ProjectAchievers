#!/usr/bin/env bash
# Laisse passer les aperçus de liens (Discord, WhatsApp, Telegram…) dans la règle WAF qui vérifie
# le trafic des hébergeurs cloud : leurs robots lisent la page et `partage.png` depuis ces
# hébergeurs, et un défi Cloudflare leur donne un lien nu, sans carte ni titre.
# Le jeton reste sur le NAS ; l'appel part du conteneur du site, qui a Node.
# Usage : bash scripts/nas-cloudflare-previews.sh
set -euo pipefail

DIR="${NAS_DIR:-/share/CACHEDEV1_DATA/project-achievers}"
if [ -n "${NAS_HOST:-}" ]; then
  SSH=(ssh -i "${NAS_KEY:-$HOME/.ssh/pa_nas}" -o IdentitiesOnly=yes "$NAS_HOST")
else
  SSH=(ssh nas-achievers)
fi

# Première ligne : le dossier ; le reste : le script Node lancé dans le conteneur.
"${SSH[@]}" ". /etc/profile; cd '$DIR' && t=\$(grep '^CLOUDFLARE_API_TOKEN=' .env | tail -1 | cut -d= -f2-) && docker exec -i -e CF_TOKEN=\"\$t\" project-achievers-site-1 node --input-type=module -" <<'EOF'
const api = async (path, init = {}) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.CF_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (!body.success) throw new Error(`${path} : ${JSON.stringify(body.errors)}`);
  return body.result;
};

/** Les robots d'aperçu de lien, reconnus à leur user agent. */
const PREVIEW_BOTS = [
  'discordbot', 'twitterbot', 'facebookexternalhit', 'slackbot', 'telegrambot', 'whatsapp',
  'linkedinbot', 'redditbot', 'cardyb', 'mastodon', 'skypeuripreview', 'embedly',
];
const previews =
  'not (' + PREVIEW_BOTS.map((bot) => `lower(http.user_agent) contains "${bot}"`).join(' or ') + ')';
const shareImage = 'not ends_with(http.request.uri.path, "/partage.png")';

const [zone] = await api('zones?name=achievers.games');
const ruleset = await api(`zones/${zone.id}/rulesets/phases/http_request_firewall_custom/entrypoint`);
const rule = ruleset.rules.find((r) => r.action === 'managed_challenge');
if (!rule) throw new Error('Règle de défi des hébergeurs cloud introuvable');

// Retire une ancienne version de ces exceptions avant de remettre la liste à jour.
const base = rule.expression
  .replace(/ and not \(lower\(http\.user_agent\) contains "discordbot".*?\)(?= and |$)/, '')
  .replace(` and ${shareImage}`, '');
const expression = `${base} and ${shareImage} and ${previews}`;

if (expression === rule.expression) {
  console.log('Déjà à jour : rien à changer.');
} else {
  await api(`zones/${zone.id}/rulesets/${ruleset.id}/rules/${rule.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      action: rule.action,
      expression,
      description:
        "Remplace Bot Fight Mode : vérifie le trafic des hébergeurs cloud, sauf l'API partenaire, OAuth, les cartes de joueur et les aperçus de liens",
      enabled: rule.enabled,
    }),
  });
  console.log('Règle mise à jour :');
  console.log(expression);
}
EOF
