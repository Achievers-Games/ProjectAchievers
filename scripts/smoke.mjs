#!/usr/bin/env node
/**
 * Vérification du site en ligne, juste après un déploiement : les pages répondent, et les
 * redirections vers d'autres sites (connexion Steam, Discord, Google…) partent bien.
 *
 *   node scripts/smoke.mjs https://achievers.games [sha-attendu]
 *
 * Avec un sha, attend d'abord que le NAS serve cette version (jusqu'à 20 minutes).
 * Aucune requête n'écrit quoi que ce soit : seulement des GET anonymes.
 */
const base = (process.argv[2] ?? 'https://achievers.games').replace(/\/$/, '');
const expected = process.argv[3];
const waitMs = process.argv[4] === undefined ? 20 * 60_000 : Number(process.argv[4]) * 1000;

const get = (path) =>
  fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: { 'User-Agent': 'Achievers-Smoke/1' },
    signal: AbortSignal.timeout(20_000),
  });

async function waitForVersion() {
  const deadline = Date.now() + waitMs;
  let seen = '?';
  while (Date.now() < deadline) {
    try {
      const health = await (await get('/api/health')).json();
      seen = health.version;
      if (seen === expected) return console.log(`version ${expected} en ligne`);
    } catch {
      // Le site redémarre pendant la mise à jour : on réessaie.
    }
    const remaining = deadline - Date.now();
    if (remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 20_000)));
  }
  throw new Error(`le site sert toujours ${seen}, pas ${expected}`);
}

/** Une redirection vers l'extérieur doit aller chez ce fournisseur, ou dire qu'il est indisponible. */
const toProvider = (host) => (response) => {
  const location = response.headers.get('location') ?? '';
  if (response.status !== 303) return `303 attendu, reçu ${response.status}`;
  if (location.startsWith('/connexion?erreur=indisponible')) return null;
  return new URL(location, base).host === host ? null : `redirige vers ${location}`;
};
const status =
  (...codes) =>
  (response) =>
    codes.includes(response.status)
      ? null
      : `${codes.join(' ou ')} attendu, reçu ${response.status}`;

const checks = [
  ['/api/health', status(200)],
  ['/', status(200)],
  ['/connexion', status(200)],
  ['/jeux', status(200)],
  // Une adresse par langue, pour les moteurs.
  ['/en/jeux', status(200)],
  ['/classement', status(200)],
  ['/clans', status(200)],
  ['/communaute', status(200)],
  ['/sitemap.xml', status(200)],
  ['/developpeurs', status(200)],
  ['/auth/steam/start', toProvider('steamcommunity.com')],
  ['/auth/discord/start', toProvider('discord.com')],
  ['/auth/google/start', toProvider('accounts.google.com')],
  ['/auth/xbox/start', toProvider('login.microsoftonline.com')],
  ['/auth/blizzard/start', toProvider('oauth.battle.net')],
  ['/auth/epic/start', toProvider('www.epicgames.com')],
  // Un client inconnu s'arrête sur place, sans planter ni rediriger.
  ['/oauth/authorize?client_id=inconnu&response_type=code', status(400)],
  ['/api/v1/openapi.json', status(200)],
  ['/api/v1/users/lookup', status(401)],
];

if (expected) await waitForVersion();
let failed = 0;
for (const [path, check] of checks) {
  let problem;
  try {
    problem = check(await get(path));
  } catch (error) {
    problem = String(error);
  }
  console.log(`${problem ? 'ÉCHEC' : 'ok   '} ${path}${problem ? ` : ${problem}` : ''}`);
  if (problem) failed++;
}
if (failed) {
  console.error(`${failed} vérification(s) en échec sur ${base}`);
  process.exit(1);
}
