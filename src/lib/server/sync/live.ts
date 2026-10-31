import { db } from '../db';
import { availableProviders } from '../providers';
import { fetchPlayingGames } from '../providers/steam';
import { connectedUsers } from './events';
import { runLiveGame } from './queue';

/** Steam n'envoie aucune notification : seuls les joueurs présents sur le site sont surveillés. */
const INTERVAL = 30_000;
const STEAM_BATCH = 100;

/** Le dernier jeu vu : il est relu une dernière fois après sa fermeture. */
const lastGames = new Map<string, string>();

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
    if (!appId) continue;
    await runLiveGame(userId, steamId, appId).catch((cause) =>
      console.error('Succès en direct :', cause),
    );
  }

  lastGames.clear();
  for (const [steamId, appId] of playing) lastGames.set(steamId, appId);
}

const globalForLive = globalThis as unknown as { paLive?: NodeJS.Timeout };

export function startLiveGames() {
  if (globalForLive.paLive || !availableProviders().STEAM) return;
  globalForLive.paLive = setInterval(() => {
    checkLiveGames().catch((cause) => console.error('Succès en direct :', cause));
  }, INTERVAL);
  globalForLive.paLive.unref();
}
