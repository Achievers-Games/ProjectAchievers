import { db } from '../db';
import { WorkScheduler } from '../workload';
import { globals } from '../globals';
import { logger } from '#lib/logger';
import { availableProviders } from '../providers';
import { fetchPlayingGames } from '../providers/steam';
import { connectedUsers } from './events';
import { enqueueSync, runLiveGame } from './queue';
import { mapLimit } from './errors';
import { fetchRecentGames, playtimeIsPublic, type OwnedGame } from './steam';

/** Steam n'envoie aucune notification : seuls les joueurs présents sur le site sont surveillés. */
const INTERVAL = 10_000;
const STEAM_BATCH = 100;
const LIVE_CONCURRENCY = 2;
/** Un succès peut tomber après la fermeture du jeu : on relit les jeux récents, sans harceler Steam. */
const CATCH_UP = 3 * 60_000;
const CATCH_UP_GAMES = 5;
const log = logger('Succès en direct');
// Les imports complets peuvent occuper le budget général pendant plusieurs minutes.
const liveWork = new WorkScheduler(1);

/** Le dernier jeu vu : il est relu une dernière fois après sa fermeture. */
const lastGames = new Map<string, string>();

/** Le dernier rattrapage par joueur, pour ne pas relire ses jeux récents à chaque passage. */
const lastCatchUp = new Map<string, number>();

/**
 * Les succès tombés pendant que la page était fermée, ou juste avant la fermeture du jeu,
 * arriveraient sinon seulement à la synchronisation complète. On relit les jeux joués ces
 * deux dernières semaines, en priorité ceux dont le temps de jeu a bougé.
 */
async function catchUpRecent(userId: string, steamId: string, checkedAppId?: string) {
  const last = lastCatchUp.get(userId) ?? 0;
  if (Date.now() - last < CATCH_UP) return;
  lastCatchUp.set(userId, Date.now());

  const recent = (await fetchRecentGames(steamId)).filter(
    (game) => String(game.appid) !== checkedAppId,
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
    select: {
      playtimeMinutes: true,
      achievementsCheckedAt: true,
      game: { select: { platformGameId: true } },
    },
  });
  const stored = new Map(rows.map((row) => [row.game.platformGameId, row]));
  const changed: OwnedGame[] = [];
  const overdue: { game: OwnedGame; checkedAt: number }[] = [];
  for (const game of recent) {
    const row = stored.get(String(game.appid));
    if (!row) continue;
    const checkedAt = row.achievementsCheckedAt?.getTime() ?? 0;
    if ((game.playtime_forever ?? 0) > row.playtimeMinutes) changed.push(game);
    else if (Date.now() - checkedAt >= CATCH_UP) overdue.push({ game, checkedAt });
  }
  overdue.sort((a, b) => a.checkedAt - b.checkedAt);
  const candidates = [...changed, ...overdue.map(({ game }) => game)].slice(0, CATCH_UP_GAMES);

  for (const game of candidates) {
    await runLiveGame(userId, steamId, String(game.appid), game.playtime_forever);
  }
}

/** Assez souvent pour que le joueur n'attende pas, sans interroger Steam à chaque passage. */
const PRIVACY_CHECK = 20_000;
let lastPrivacyCheck = 0;

/**
 * Un joueur à qui le site vient de dire que son temps de jeu est privé part le régler dans
 * Steam, puis revient : sans cela il attendrait la prochaine synchronisation en croyant à une
 * panne. Tant qu'il est sur le site, on regarde si Steam annonce de nouveau du temps de jeu, et
 * la synchronisation repart aussitôt.
 */
async function resyncUnhidden(userIds: string[]) {
  if (!userIds.length || Date.now() - lastPrivacyCheck < PRIVACY_CHECK) return;
  lastPrivacyCheck = Date.now();
  const accounts = await db.linkedAccount.findMany({
    where: {
      provider: 'STEAM',
      playtimeHidden: true,
      userId: { in: userIds },
      syncStatus: { notIn: ['QUEUED', 'SYNCING'] },
    },
    select: { userId: true, providerUserId: true },
  });
  await mapLimit(accounts, LIVE_CONCURRENCY, async ({ userId, providerUserId }) => {
    if (await playtimeIsPublic(providerUserId).catch(() => false)) {
      await enqueueSync(userId, 'STEAM', true);
    }
  });
}

export async function checkLiveGames() {
  const userIds = connectedUsers();
  await resyncUnhidden(userIds).catch((cause) => log.error(cause));
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

  const checks = accounts.map(({ userId, providerUserId: steamId }) => ({
    userId,
    steamId,
    appId: playing.get(steamId) ?? lastGames.get(steamId),
  }));
  // Vérifier les jeux actifs avant de relire l'historique des autres joueurs.
  await mapLimit(checks, LIVE_CONCURRENCY, async ({ userId, steamId, appId }) => {
    if (appId) await runLiveGame(userId, steamId, appId).catch((cause) => log.error(cause));
  });

  lastGames.clear();
  for (const [steamId, appId] of playing) lastGames.set(steamId, appId);

  await mapLimit(checks, LIVE_CONCURRENCY, async ({ userId, steamId, appId }) => {
    await catchUpRecent(userId, steamId, appId).catch((cause) => log.error(cause));
  });

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
    await liveWork.run('Steam en direct', checkLiveGames);
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
