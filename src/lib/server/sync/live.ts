import { db } from '../db';
import { WorkScheduler } from '../workload';
import { globals } from '../globals';
import { logger } from '#lib/logger';
import { applyAccountLook, type AccountLook } from '../accounts';
import { availableProviders } from '../providers';
import { fetchSteamLook, fetchSteamSummaries } from '../providers/steam';
import { visibleUsers } from './events';
import { enqueueSync, runLiveGame } from './queue';
import { mapLimit } from './errors';
import { achievementCounts, fetchLibrary, fetchRecentGames, playtimeIsPublic } from './steam';

/**
 * Steam n'envoie aucune notification : le site va voir. Pour les joueurs qui ont une page
 * visible, trois rythmes, du plus léger au plus lourd :
 * - toutes les 10 s : le jeu en cours et l'avatar ;
 * - chaque minute : les jeux récents dont le nombre de succès a bougé, le cadre et l'avatar
 *   animé, ou, si le temps de jeu est privé, le retour du temps de jeu public ;
 * - à l'arrivée puis chaque heure : la bibliothèque, pour un jeu acheté sans être lancé.
 * Les absents passent une fois par jour par la même tournée (`steamDailyPass`). La
 * synchronisation complète ne part plus qu'à la liaison, au bouton, ou pour importer un jeu neuf.
 */
const INTERVAL = 10_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STEAM_BATCH = 100;
const LIVE_CONCURRENCY = 2;
const log = logger('Succès en direct');
// Les imports complets peuvent occuper le budget général pendant plusieurs minutes.
const liveWork = new WorkScheduler(1);

/** Le dernier jeu vu : il est relu une dernière fois après sa fermeture. */
const lastGames = new Map<string, string>();
/** Les passages de la minute et de l'heure, par joueur présent. */
const lastMinute = new Map<string, number>();
const lastHour = new Map<string, number>();
/** Les jeux neufs déjà signalés : un jeu que l'import ne retient pas ne le relance pas sans fin. */
const requested = new Map<string, Set<string>>();

type SteamAccount = {
  id: string;
  userId: string;
  providerUserId: string;
  playtimeHidden: boolean;
  avatarUrl: string | null;
} & AccountLook;

const accountSelect = {
  id: true,
  userId: true,
  providerUserId: true,
  playtimeHidden: true,
  avatarUrl: true,
  avatarMotionUrl: true,
  frameUrl: true,
  frameMotionUrl: true,
} as const;

/**
 * Des jeux que le profil n'a pas encore : un jeu acheté, ou lancé pour la première fois. Seuls
 * ceux qui ont des succès valent un import, que fait la synchronisation complète.
 */
async function importUnknown(userId: string, steamId: string, appIds: string[]) {
  const seen = requested.get(userId) ?? new Set<string>();
  requested.set(userId, seen);
  const fresh = appIds.filter((appId) => !seen.has(appId));
  if (!fresh.length) return;
  for (const appId of fresh) seen.add(appId);
  const counts = await achievementCounts(steamId, fresh.map(Number)).catch(() => null);
  const worth = !counts || fresh.some((appId) => (counts.get(Number(appId))?.total ?? 0) > 0);
  if (worth) await enqueueSync(userId, 'STEAM', true);
}

/**
 * Les succès tombés pendant que la page était fermée, ou juste avant la fermeture du jeu.
 * Steam dit en un appel combien de succès le joueur a sur ses jeux des deux dernières semaines :
 * seuls ceux qui en ont un de plus que la base sont relus. Un succès que Steam expose en retard
 * change ce nombre au passage suivant, sans filet à part.
 */
async function catchUpRecent(userId: string, steamId: string, checkedAppId?: string) {
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
      gameId: true,
      unlockedCount: true,
      playtimeMinutes: true,
      game: { select: { platformGameId: true } },
    },
  });
  const stored = new Map(rows.map((row) => [row.game.platformGameId, row]));
  const known = recent.filter((game) => stored.has(String(game.appid)));
  const unknown = recent.filter((game) => !stored.has(String(game.appid)));
  if (unknown.length) {
    await importUnknown(
      userId,
      steamId,
      unknown.map((game) => String(game.appid)),
    );
  }
  if (!known.length) return;

  // Une méthode non documentée peut disparaître : le temps de jeu qui bouge prend alors le relais.
  const counts = await achievementCounts(
    steamId,
    known.map((game) => game.appid),
  ).catch((cause) => {
    log.error('Décomptes Steam :', cause);
    return null;
  });

  for (const game of known) {
    const row = stored.get(String(game.appid))!;
    const minutes = game.playtime_forever ?? 0;
    const count = counts?.get(game.appid);
    // Seul un succès en plus compte : la relecture ne retire rien. Un jeu absent de la réponse
    // retombe sur le temps de jeu.
    const changed = count ? count.unlocked > row.unlockedCount : minutes > row.playtimeMinutes;
    if (changed) {
      await runLiveGame(userId, steamId, String(game.appid), game.playtime_forever);
    } else if (minutes > row.playtimeMinutes) {
      // Rien de neuf côté succès : le temps de jeu se met à jour sans rien demander à Steam.
      await db.userGame.updateMany({
        where: { userId, gameId: row.gameId },
        data: { playtimeMinutes: minutes },
      });
    }
  }
}

/**
 * Un joueur à qui le site vient de dire que son temps de jeu est privé part le régler dans
 * Steam, puis revient. Ses jeux récents ne disent rien tant que le temps est privé : à leur
 * place, on regarde si Steam annonce de nouveau du temps de jeu, et la synchronisation complète
 * repart aussitôt, avec les jeux qui manquaient.
 */
async function resyncUnhidden(userId: string, steamId: string) {
  if (await playtimeIsPublic(steamId).catch(() => false)) {
    await enqueueSync(userId, 'STEAM', true);
  }
}

const sameLook = (account: AccountLook, look: AccountLook) =>
  account.avatarMotionUrl === look.avatarMotionUrl &&
  account.frameUrl === look.frameUrl &&
  account.frameMotionUrl === look.frameMotionUrl;

/** Le cadre et l'avatar animé, en un appel : rien n'est écrit s'ils n'ont pas changé. */
async function refreshLook(account: SteamAccount) {
  const look = await fetchSteamLook(account.providerUserId);
  if (look && !sameLook(account, look)) await applyAccountLook(account, look);
}

/** Un jeu acheté sans être lancé n'apparaît dans aucun jeu récent : la bibliothèque le dit. */
async function checkLibrary(userId: string, steamId: string) {
  const library = await fetchLibrary(steamId);
  if (!library.length) return;
  const rows = await db.userGame.findMany({
    where: { userId, game: { platform: 'STEAM' } },
    select: { game: { select: { platformGameId: true } } },
  });
  const known = new Set(rows.map((row) => row.game.platformGameId));
  const unknown = library.map((game) => String(game.appid)).filter((appId) => !known.has(appId));
  if (unknown.length) await importUnknown(userId, steamId, unknown);
}

/** Le passage de la minute d'un joueur : jeux récents, ou retour du temps public, et apparence. */
async function minutePass(account: SteamAccount, checkedAppId?: string) {
  const { userId, providerUserId: steamId } = account;
  await (
    account.playtimeHidden
      ? resyncUnhidden(userId, steamId)
      : catchUpRecent(userId, steamId, checkedAppId)
  ).catch((cause) => log.error(cause));
  await refreshLook(account).catch((cause) => log.error('Apparence Steam :', cause));
}

export async function checkLiveGames() {
  const userIds = visibleUsers();
  const accounts: SteamAccount[] = userIds.length
    ? await db.linkedAccount.findMany({
        where: {
          provider: 'STEAM',
          userId: { in: userIds },
          syncStatus: { notIn: ['QUEUED', 'SYNCING'] },
        },
        select: accountSelect,
      })
    : [];

  // Un seul appel pour 100 joueurs : le jeu en cours et l'avatar.
  const playing = new Map<string, string>();
  for (let index = 0; index < accounts.length; index += STEAM_BATCH) {
    const batch = accounts.slice(index, index + STEAM_BATCH);
    const summaries = await fetchSteamSummaries(batch.map((account) => account.providerUserId));
    for (const account of batch) {
      const summary = summaries.get(account.providerUserId);
      if (summary?.gameId) playing.set(account.providerUserId, summary.gameId);
      if (summary?.avatarUrl && summary.avatarUrl !== account.avatarUrl) {
        const { avatarMotionUrl, frameUrl, frameMotionUrl } = account;
        await applyAccountLook(
          account,
          { avatarMotionUrl, frameUrl, frameMotionUrl },
          summary.avatarUrl,
        ).catch((cause) => log.error('Avatar Steam :', cause));
        account.avatarUrl = summary.avatarUrl;
      }
    }
  }

  const checks = accounts.map((account) => ({
    account,
    appId: playing.get(account.providerUserId) ?? lastGames.get(account.providerUserId),
  }));
  // Vérifier les jeux actifs avant tout le reste.
  await mapLimit(checks, LIVE_CONCURRENCY, async ({ account, appId }) => {
    if (!appId) return;
    const { userId, providerUserId: steamId } = account;
    try {
      const gained = await runLiveGame(userId, steamId, appId);
      if (gained === null) await importUnknown(userId, steamId, [appId]);
    } catch (cause) {
      log.error(cause);
    }
  });

  lastGames.clear();
  for (const [steamId, appId] of playing) lastGames.set(steamId, appId);

  const now = Date.now();
  await mapLimit(checks, LIVE_CONCURRENCY, async ({ account, appId }) => {
    const { userId, providerUserId: steamId } = account;
    if (now - (lastMinute.get(userId) ?? 0) >= MINUTE) {
      lastMinute.set(userId, now);
      await minutePass(account, appId);
    }
    if (now - (lastHour.get(userId) ?? 0) >= HOUR) {
      lastHour.set(userId, now);
      await checkLibrary(userId, steamId).catch((cause) => log.error('Bibliothèque :', cause));
    }
  });

  // Un joueur parti ne laisse rien en mémoire : à son retour, tout repart comme à l'arrivée.
  const present = new Set(accounts.map((account) => account.userId));
  for (const map of [lastMinute, lastHour, requested]) {
    for (const userId of map.keys()) if (!present.has(userId)) map.delete(userId);
  }
}

/**
 * La tournée quotidienne d'un joueur absent : la même que celle d'un joueur présent, une fois
 * par jour. Une fenêtre de deux semaines relue chaque jour ne laisse passer aucun jeu joué.
 */
export async function steamDailyPass(userId: string) {
  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: accountSelect,
  });
  if (!account) return;
  await minutePass(account);
  await checkLibrary(userId, account.providerUserId).catch((cause) =>
    log.error('Bibliothèque :', cause),
  );
  // Absent, il n'est plus suivi en direct : sa liste de jeux signalés n'a plus lieu d'être.
  requested.delete(userId);
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
