import { db } from '../db';
import { WorkScheduler } from '../workload';
import { globals } from '../globals';
import { logger } from '#lib/logger';
import { applyAccountLook, type AccountLook } from '../accounts';
import { availableProviders } from '../providers';
import { fetchSteamLook, fetchSteamSummaries, type SteamSummary } from '../providers/steam';
import { connectedUsers, visibleUsers } from './events';
import { enqueueSync, runLiveGame } from './queue';
import { mapLimit, SyncError } from './errors';
import {
  achievementCounts,
  addSteamGame,
  fetchLibrary,
  fetchOwnedApps,
  fetchRecentGames,
  fetchTopAchievements,
  steamPrivacy,
  steamVisibility,
  type SteamPrivacy,
  steamAppInfo,
  type OwnedGame,
  type TopGame,
} from './steam';

/**
 * Steam n'envoie aucune notification : le site va voir, le moins souvent possible.
 * - toutes les 10 s, pour tout joueur qui a une page ouverte, même en arrière-plan (il joue
 *   souvent ainsi) : le jeu en cours et l'avatar, d'un seul appel pour 100 joueurs. Un avatar
 *   changé fait relire l'avatar animé et le cadre ; un jeu inconnu entre aussitôt au profil ;
 * - à l'arrivée sur le site : les succès tombés pendant l'absence, ou le retour du temps de jeu
 *   public, et l'apparence ;
 * - toutes les 5 min, si la page est visible : le cadre, que l'avatar ne trahit pas.
 * Une fois par jour, chacun passe par la même tournée, plus la bibliothèque, pour un jeu acheté
 * sans être lancé (`steamDailyPass`) ; le bouton lance la même. La synchronisation complète ne
 * part qu'à la liaison, ou pour reprendre un compte en échec.
 */
const INTERVAL = 10_000;
const MINUTE = 60_000;
/** Un retour après cette absence est une arrivée : le rattrapage repart. */
const ARRIVAL_GAP = 10 * MINUTE;
const LOOK_EVERY = 5 * MINUTE;
/** La fenêtre des jeux cachés demande toutes les 5 s : jamais plus d'un appel Steam par 4 s. */
const PRIVACY_EVERY = 4_000;
/** Les jeux qui servent à sonder Steam : assez pour en trouver un où le temps n'est pas nul. */
const PRIVACY_PROBE = 10;
const LIVE_CONCURRENCY = 2;
const log = logger('Succès en direct');
// Les imports complets peuvent occuper le budget général pendant plusieurs minutes.
// Elle tourne toutes les 10 s : son journal ne s'écrit qu'avec LOG_LEVEL=debug.
const liveWork = new WorkScheduler(1, 'debug');

/** Le dernier jeu vu : il est relu une dernière fois après sa fermeture. */
const lastGames = new Map<string, string>();
/** Le dernier passage où chaque joueur était sur le site. */
const lastPresent = new Map<string, number>();
/** La dernière lecture du cadre, par joueur. */
const lastLook = new Map<string, number>();
/** La dernière réponse de Steam sur les jeux cachés, par joueur. */
const lastPrivacy = new Map<string, { at: number; fixed: boolean }>();
/** Steam réglé pendant une synchronisation : elle a pu lire la bibliothèque avant. */
const unhideAfterSync = new Set<string>();
/** Les jeux neufs déjà signalés : un jeu que l'import ne retient pas ne le relance pas sans fin. */
const requested = new Map<string, Set<string>>();

type SteamAccount = {
  id: string;
  userId: string;
  providerUserId: string;
  playtimeHidden: boolean;
  syncError: string | null;
  avatarUrl: string | null;
} & AccountLook;

const accountSelect = {
  id: true,
  userId: true,
  providerUserId: true,
  playtimeHidden: true,
  syncError: true,
  avatarUrl: true,
  avatarMotionUrl: true,
  frameUrl: true,
  frameMotionUrl: true,
} as const;

/**
 * Des jeux que le profil n'a pas encore : un jeu acheté, ou lancé pour la première fois. Ceux
 * sans succès entrent pour leur seul temps de jeu. Seulement s'ils sont au joueur : dans sa
 * bibliothèque (jeux de la famille compris) ou gratuits. Un jeu prêté hors famille ou retiré
 * n'entre pas, comme dans la synchronisation complète. Chacun entre seul, puis le suivi en
 * direct lit ses succès. `owned` : les jeux viennent déjà de la bibliothèque.
 */
async function importUnknown(
  userId: string,
  steamId: string,
  games: { appid: number; name?: string; playtime_forever?: number }[],
  owned = false,
) {
  const seen = requested.get(userId) ?? new Set<string>();
  requested.set(userId, seen);
  const fresh = games.filter((game) => !seen.has(String(game.appid)));
  if (!fresh.length) return;
  for (const game of fresh) seen.add(String(game.appid));
  const counts = await achievementCounts(
    steamId,
    fresh.map((game) => game.appid),
  ).catch(() => null);
  // Un jeu sans succès entre aussi, pour son temps de jeu, sans rien de plus à lire chez Steam.
  const statless = (game: { appid: number }) => Boolean(counts && !counts.get(game.appid)?.total);

  const sources = owned
    ? new Map(fresh.map((game) => [game.appid, game as OwnedGame]))
    : await ownedOrFree(steamId, fresh);
  for (const game of fresh) {
    const source = sources.get(game.appid);
    if (!source) continue;
    await addSteamGame(userId, source, statless(game));
    if (!statless(game))
      await runLiveGame(userId, steamId, String(source.appid), source.playtime_forever);
  }
}

/**
 * Ceux de ces jeux que le joueur peut garder. La bibliothèque se lit filtrée sur eux (quelques
 * centaines d'octets). Un jeu gratuit lancé pour la première fois n'y est pas encore : la
 * boutique dit qu'il est gratuit, donc à tout le monde.
 */
async function ownedOrFree(
  steamId: string,
  games: { appid: number; name?: string; playtime_forever?: number }[],
) {
  // Un profil passé privé n'a plus de bibliothèque : rien n'entre, sans rien écrire au journal.
  const owned = await fetchOwnedApps(
    steamId,
    games.map((game) => game.appid),
  ).catch((cause: unknown) => {
    if (!(cause instanceof SyncError)) log.error('Bibliothèque :', cause);
    return [];
  });
  const sources = new Map<number, OwnedGame>(owned.map((game) => [game.appid, game]));
  for (const game of games) {
    if (sources.has(game.appid)) continue;
    const app = await steamAppInfo(game.appid);
    if (!app?.free) continue;
    sources.set(game.appid, {
      appid: game.appid,
      name: game.name ?? app.name,
      playtime_forever: game.playtime_forever,
    });
  }
  return sources;
}

/**
 * Les succès tombés pendant que la page était fermée, ou juste avant la fermeture du jeu.
 * Steam dit en un appel quels succès le joueur a sur ses jeux des deux dernières semaines :
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
  if (unknown.length) await importUnknown(userId, steamId, unknown);
  if (!known.length) return;

  // Une méthode non documentée peut disparaître : le temps de jeu qui bouge prend alors le relais.
  const tops = new Map<number, TopGame>();
  const counts = await fetchTopAchievements(
    steamId,
    known.map((game) => game.appid),
    async (appId, top) => void tops.set(appId, top),
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
      const appId = String(game.appid);
      await runLiveGame(userId, steamId, appId, game.playtime_forever, tops.get(game.appid));
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
 * Steam montre-t-il de nouveau ce que la dernière synchronisation n'a pas pu lire ? Seuls quelques
 * jeux où le joueur a des succès sont demandés.
 */
async function privacyFixed(userId: string, steamId: string, issue: SteamPrivacy) {
  const probe = await db.userGame.findMany({
    where: { userId, unlockedCount: { gt: 0 }, game: { platform: 'STEAM' } },
    orderBy: { unlockedCount: 'desc' },
    take: PRIVACY_PROBE,
    select: { game: { select: { platformGameId: true } } },
  });
  const seen = await steamVisibility(
    steamId,
    probe.map((row) => Number(row.game.platformGameId)),
  ).catch(() => null);
  return !!seen && (issue === 'library' ? seen.library : seen.playtime);
}

/**
 * Un joueur à qui le site a dit que Steam lui cachait ses jeux part le régler, puis revient. Ses
 * jeux récents ne disent rien tant que c'est caché : à leur place, on regarde si Steam les montre
 * de nouveau, et la synchronisation complète repart aussitôt, avec les jeux qui manquaient.
 */
async function resyncUnhidden(userId: string, steamId: string, issue: SteamPrivacy) {
  if (await privacyFixed(userId, steamId, issue)) await enqueueSync(userId, 'STEAM', true);
}

/**
 * La fenêtre « Il manque des jeux à ton profil » demande, tant qu'elle est ouverte, si le joueur a
 * réglé Steam : dès que Steam montre ce qui manquait, la synchronisation complète part.
 */
export async function checkSteamPrivacy(userId: string) {
  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: { providerUserId: true, playtimeHidden: true, syncError: true },
  });
  const issue = account && steamPrivacy(account);
  // Plus rien de caché : une synchronisation l'a déjà constaté. Un retour au privé repartira de zéro.
  if (!issue) {
    lastPrivacy.delete(userId);
    return true;
  }

  const now = Date.now();
  const last = lastPrivacy.get(userId);
  if (last && now - last.at < PRIVACY_EVERY) return last.fixed;
  lastPrivacy.set(userId, { at: now, fixed: last?.fixed ?? false });

  const fixed = await privacyFixed(userId, account.providerUserId, issue);
  lastPrivacy.set(userId, { at: now, fixed });
  // Une synchronisation déjà en cours refuse la nouvelle : celle-ci partira dès sa fin.
  if (fixed && !last?.fixed && !(await enqueueSync(userId, 'STEAM'))) {
    unhideAfterSync.add(userId);
  }
  return fixed;
}

/**
 * Fin d'une synchronisation Steam. Si le joueur a réglé Steam pendant qu'elle tournait et qu'elle
 * a encore trouvé ses jeux cachés, une autre repart aussitôt.
 */
export async function afterSteamSync(userId: string) {
  if (!unhideAfterSync.delete(userId)) return;
  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: { playtimeHidden: true, syncError: true },
  });
  if (account && steamPrivacy(account)) await enqueueSync(userId, 'STEAM');
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
  const unknown = library.filter((game) => !known.has(String(game.appid)));
  if (unknown.length) await importUnknown(userId, steamId, unknown, true);
}

/** Au retour du joueur, et chaque jour : jeux récents, ou retour des jeux cachés, et apparence. */
async function catchUp(account: SteamAccount, checkedAppId?: string) {
  const { userId, providerUserId: steamId } = account;
  const issue = steamPrivacy(account);
  await (
    issue ? resyncUnhidden(userId, steamId, issue) : catchUpRecent(userId, steamId, checkedAppId)
  ).catch((cause) => log.error(cause));
  await refreshLook(account).catch((cause) => log.error('Apparence Steam :', cause));
}

export async function checkLiveGames() {
  const userIds = connectedUsers();
  const visible = new Set(visibleUsers());
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

  // Un seul appel pour 100 joueurs, partagé avec la page « jeu en cours » des profils.
  const playing = new Map<string, string>();
  const summaries = accounts.length
    ? await fetchSteamSummaries(accounts.map((account) => account.providerUserId))
    : new Map<string, SteamSummary>();
  const now = Date.now();
  // Ce que le joueur voit dans `/compte` : au plus une écriture par minute et par compte.
  if (summaries.size) {
    await db.linkedAccount.updateMany({
      where: {
        id: { in: accounts.map((account) => account.id) },
        OR: [{ liveCheckedAt: null }, { liveCheckedAt: { lt: new Date(now - MINUTE) } }],
      },
      data: { liveCheckedAt: new Date(now) },
    });
  }
  for (const account of accounts) {
    const summary = summaries.get(account.providerUserId);
    if (summary?.gameId) playing.set(account.providerUserId, summary.gameId);
    if (summary?.avatarUrl && summary.avatarUrl !== account.avatarUrl) {
      // Équiper un avatar animé change aussi l'avatar fixe : c'est le signal de relire les deux.
      const look = await fetchSteamLook(account.providerUserId);
      const { avatarMotionUrl, frameUrl, frameMotionUrl } = account;
      await applyAccountLook(
        account,
        look ?? { avatarMotionUrl, frameUrl, frameMotionUrl },
        summary.avatarUrl,
      ).catch((cause) => log.error('Avatar Steam :', cause));
      account.avatarUrl = summary.avatarUrl;
      if (look) Object.assign(account, look);
      lastLook.set(account.userId, now);
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
      if (gained === null) await importUnknown(userId, steamId, [{ appid: Number(appId) }]);
    } catch (cause) {
      log.error(cause);
    }
  });

  lastGames.clear();
  for (const [steamId, appId] of playing) lastGames.set(steamId, appId);

  await mapLimit(checks, LIVE_CONCURRENCY, async ({ account, appId }) => {
    const { userId } = account;
    const arrived = now - (lastPresent.get(userId) ?? 0) > ARRIVAL_GAP;
    lastPresent.set(userId, now);
    if (arrived) {
      lastLook.set(userId, now);
      await catchUp(account, appId);
    } else if (visible.has(userId) && now - (lastLook.get(userId) ?? 0) >= LOOK_EVERY) {
      // Le cadre ne change pas l'avatar : seule une lecture à part le voit.
      lastLook.set(userId, now);
      await refreshLook(account).catch((cause) => log.error('Apparence Steam :', cause));
    }
  });

  // Un joueur parti depuis longtemps ne laisse rien en mémoire : à son retour, tout repart.
  for (const [userId, at] of lastPresent) {
    if (now - at <= ARRIVAL_GAP) continue;
    lastPresent.delete(userId);
    lastLook.delete(userId);
    requested.delete(userId);
  }
}

/**
 * La tournée quotidienne : celle de l'arrivée, plus la bibliothèque. Une fenêtre de deux
 * semaines relue chaque jour ne laisse passer aucun jeu joué, et un jeu acheté sans être lancé
 * apparaît au plus tard le lendemain.
 */
export async function steamDailyPass(userId: string) {
  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: accountSelect,
  });
  if (!account) return;
  await catchUp(account);
  await checkLibrary(userId, account.providerUserId).catch((cause) =>
    log.error('Bibliothèque :', cause),
  );
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
