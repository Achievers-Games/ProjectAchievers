import { db } from '../db';
import { globals } from '../globals';
import { logger } from '#lib/logger';
import { availableProviders } from '../providers';
import { fetchPlayingGames } from '../providers/steam';
import { connectedUsers } from './events';
import { runLiveGame } from './queue';
import { fetchRecentGames } from './steam';

/** Steam n'envoie aucune notification : seuls les joueurs présents sur le site sont surveillés. */
const INTERVAL = 30_000;
const STEAM_BATCH = 100;
/** Un succès peut tomber après la fermeture du jeu : on relit les jeux récents, sans harceler Steam. */
const CATCH_UP = 3 * 60_000;
const CATCH_UP_GAMES = 5;
const log = logger('Succès en direct');

/** Le dernier jeu vu : il est relu une dernière fois après sa fermeture. */
const lastGames = new Map<string, string>();

/** Le dernier rattrapage par joueur, pour ne pas relire ses jeux récents à chaque passage. */
const lastCatchUp = new Map<string, number>();

/**
 * Les succès tombés pendant que la page était fermée, ou juste avant la fermeture du jeu,
 * arriveraient sinon seulement à la synchronisation complète. On relit les jeux joués ces
 * deux dernières semaines et on ne garde que ceux dont le temps de jeu a bougé.
 */
async function catchUpRecent(userId: string, steamId: string) {
  const last = lastCatchUp.get(userId) ?? 0;
  if (Date.now() - last < CATCH_UP) return;
  lastCatchUp.set(userId, Date.now());

  const recent = (await fetchRecentGames(steamId)).filter(
    (game) => game.playtime_forever !== undefined,
  );
  if (!recent.length) return;

  const rows = await db.userGame.findMany({
    where: {
      userId,
      game: {
        platform: 'STEAM',
        platformGameId: { in: recent.map((game) => String(game.appid)) },
      },
    },
    select: { playtimeMinutes: true, game: { select: { platformGameId: true } } },
  });
  const stored = new Map(rows.map((row) => [row.game.platformGameId, row.playtimeMinutes]));
  const moved = recent
    .filter((game) => (game.playtime_forever ?? 0) > (stored.get(String(game.appid)) ?? Infinity))
    .slice(0, CATCH_UP_GAMES);

  for (const game of moved) {
    await runLiveGame(userId, steamId, String(game.appid), game.playtime_forever);
  }
}

export async function checkLiveGames() {
  const userIds = connectedUsers();
  const accounts = userIds.length
    ? await db.linkedAccount.findMany({
        where: {
          provider: 'STEAM',
          userId: { in: userIds },
          syncStatus: { notIn: ['QUEUED', 'SYNCING'] },
        },
        select: { userId: true, providerUserId: true },
      })
    : [];

  const playing = new Map<string, string>();
  for (let index = 0; index < accounts.length; index += STEAM_BATCH) {
    const batch = accounts.slice(index, index + STEAM_BATCH);
    const games = await fetchPlayingGames(batch.map((account) => account.providerUserId));
    for (const [steamId, appId] of games) playing.set(steamId, appId);
  }

  for (const { userId, providerUserId: steamId } of accounts) {
    const appId = playing.get(steamId) ?? lastGames.get(steamId);
    if (appId) await runLiveGame(userId, steamId, appId).catch((cause) => log.error(cause));
    await catchUpRecent(userId, steamId).catch((cause) => log.error(cause));
  }

  lastGames.clear();
  for (const [steamId, appId] of playing) lastGames.set(steamId, appId);

  // Un joueur qui ferme sa page ne doit pas laisser son horodatage en mémoire.
  const connected = new Set(accounts.map((account) => account.userId));
  for (const userId of lastCatchUp.keys()) {
    if (!connected.has(userId)) lastCatchUp.delete(userId);
  }
}

let checking = false;

/** Steam peut être lent : un passage ne commence jamais avant la fin du précédent. */
async function tick() {
  if (checking) return;
  checking = true;
  try {
    await checkLiveGames();
  } catch (cause) {
    log.error(cause);
  } finally {
    checking = false;
  }
}

export function startLiveGames() {
  if (globals.paLive || !availableProviders().STEAM) return;
  globals.paLive = setInterval(() => void tick(), INTERVAL);
  globals.paLive.unref();
}
