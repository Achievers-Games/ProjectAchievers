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
  fetchUnlocks,
  fetchUnlockList,
  fetchRecentGames,
  fetchTopAchievements,
  steamPrivacy,
  steamVisibility,
  type SteamPrivacy,
  steamAppInfo,
  steamPlayedAt,
  recentlyPlayedAt,
  type OwnedGame,
  type TopGame,
} from './steam';
import { REMOVAL_CONFIRM, saveProgress } from './store';

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
/** Les succès d'un joueur absent qui joue : lus au plus toutes les 5 minutes, quota oblige. */
const ABSENT_READ_EVERY = 5 * MINUTE;
/** Le jeu en cours de chaque joueur absent : relu une dernière fois à sa fermeture. */
const absentGames = new Map<string, string>();
/** La dernière lecture des succès de chaque joueur absent. */
const absentReads = new Map<string, number>();
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
  backgroundUrl: true,
  backgroundMotionUrl: true,
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
      reportedUnlockedCount: true,
      removalSeenAt: true,
      playtimeMinutes: true,
      lastPlayedAt: true,
      game: { select: { platformGameId: true } },
    },
  });
  const stored = new Map(rows.map((row) => [row.game.platformGameId, row]));
  const now = Date.now();
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
    const confirmRemoval =
      row.removalSeenAt && Date.now() - row.removalSeenAt.getTime() >= REMOVAL_CONFIRM;
    const changed =
      confirmRemoval ||
      (count ? count.unlocked !== row.reportedUnlockedCount : minutes > row.playtimeMinutes);
    // Du temps en plus depuis la dernière lecture : le jeu a été lancé entre-temps. Sinon, le
    // jeu figure parmi ceux joués ces deux semaines : sans date aussi récente en base, il est
    // daté au début de la fenêtre, derrière tout lancement vraiment daté.
    const lastPlayedAt =
      steamPlayedAt(game, row.playtimeMinutes) ??
      recentlyPlayedAt(row.lastPlayedAt, recent.indexOf(game), now);
    if (changed) {
      const appId = String(game.appid);
      await runLiveGame(userId, steamId, appId, game.playtime_forever, tops.get(game.appid));
    }
    if (lastPlayedAt) {
      // Le temps de jeu se met à jour sans rien demander à Steam ; la relecture l'a déjà fait.
      await db.userGame.updateMany({
        where: { userId, gameId: row.gameId },
        data: { ...(!changed && { playtimeMinutes: minutes }), lastPlayedAt },
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
  account.frameMotionUrl === look.frameMotionUrl &&
  account.backgroundUrl === look.backgroundUrl &&
  account.backgroundMotionUrl === look.backgroundMotionUrl;

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

/**
 * Le jeu tourne en ce moment : c'est son dernier lancement. Au plus une écriture par minute et
 * par jeu, comme `liveCheckedAt`.
 */
async function notePlaying(userId: string, appId: string, now: number) {
  await db.userGame.updateMany({
    where: {
      userId,
      game: { platform: 'STEAM', platformGameId: appId },
      OR: [{ lastPlayedAt: null }, { lastPlayedAt: { lt: new Date(now - MINUTE) } }],
    },
    data: { lastPlayedAt: new Date(now) },
  });
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

  // Les joueurs absents passent dans le même appel : Steam ne donne plus la date du dernier
  // lancement, seul le jeu en cours la révèle. Pour eux, rien d'autre n'est lu.
  const absent = await db.linkedAccount.findMany({
    where: {
      provider: 'STEAM',
      userId: { notIn: userIds },
      syncStatus: { notIn: ['QUEUED', 'SYNCING'] },
    },
    select: { userId: true, providerUserId: true },
  });

  // Un seul appel pour 100 joueurs, partagé avec la page « jeu en cours » des profils.
  const playing = new Map<string, string>();
  const steamIds = [...accounts, ...absent].map((account) => account.providerUserId);
  const summaries = steamIds.length
    ? await fetchSteamSummaries(steamIds)
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
      if (playing.has(steamId)) await notePlaying(userId, appId, now);
    } catch (cause) {
      log.error(cause);
    }
  });

  lastGames.clear();
  for (const [steamId, appId] of playing) lastGames.set(steamId, appId);

  // Un joueur absent qui joue : son jeu est daté à la minute près, pour le rail de ses amis, et
  // ses succès arrivent comme ceux d'un joueur présent, mais lus toutes les 5 minutes au plus
  // (le quota Steam est partagé par tout le site), plus une dernière fois quand il ferme le jeu.
  const stillPlaying = new Map<string, string>();
  await mapLimit(absent, LIVE_CONCURRENCY, async ({ userId, providerUserId: steamId }) => {
    const current = summaries.get(steamId)?.gameId;
    const closed = current ? undefined : absentGames.get(steamId);
    const appId = current ?? closed;
    if (!appId) return;
    if (current) stillPlaying.set(steamId, current);
    try {
      if (current) await notePlaying(userId, current, now);
      if (!closed && now - (absentReads.get(userId) ?? 0) < ABSENT_READ_EVERY) return;
      absentReads.set(userId, now);
      const gained = await runLiveGame(userId, steamId, appId);
      // Un jeu pas encore dans sa bibliothèque : importé comme pour un joueur présent.
      if (gained === null) await importUnknown(userId, steamId, [{ appid: Number(appId) }]);
    } catch (cause) {
      log.error(cause);
    }
  });
  absentGames.clear();
  for (const [steamId, appId] of stillPlaying) absentGames.set(steamId, appId);
  for (const [userId, at] of absentReads) {
    if (now - at > ARRIVAL_GAP) absentReads.delete(userId);
  }

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

  // Ses jeux bloqués ou en attente : une remise à zéro se voit dans les 30 s.
  await recheckBlockedSteam(accounts.map((account) => account.userId)).catch((cause) =>
    log.error('Jeux bloqués :', cause),
  );

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
/** Un joueur présent voit ses jeux bloqués relus au plus toutes les 30 s. */
const BLOCKED_EVERY = 30_000;
const blockedReads = new Map<string, number>();
/** La dernière revue relue par la tournée de fond : la suivante reprend juste après. */
let blockedCursor: string | null = null;

/**
 * Relit les jeux bloqués ou en attente, sans attendre que le joueur y rejoue : une remise à zéro
 * (`reset_all_stats`) lève le blocage aussitôt, et le temps de jeu frais (hors ligne compris)
 * refait le score de confiance. `userIds` : les joueurs présents, ou celui qui ouvre la page de
 * son jeu bloqué ; sans eux, tous les comptes, pour la tournée de fond.
 */
export async function recheckBlockedSteam(userIds?: string[], limit = 50, gameId?: string) {
  if (!availableProviders().STEAM) return;
  const now = Date.now();
  const due = userIds?.filter((id) => now - (blockedReads.get(id) ?? 0) >= BLOCKED_EVERY);
  if (due && !due.length) return;
  // La tournée de fond avance d'une page à chaque passage ; sinon, les 50 plus anciens blocages
  // (souvent des refus définitifs) seraient relus à chaque fois, et jamais les suivants.
  const rotating = !due && !gameId;
  const page = (after: string | null) =>
    db.steamIntegrityReview.findMany({
      where: {
        userId: due ? { in: due } : { not: null },
        ...(gameId && { gameId }),
        ...(after && { id: { gt: after } }),
        OR: [
          { status: 'PENDING' },
          { suspendedAt: { not: null } },
          { rejected: { isEmpty: false } },
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        steamId: true,
        gameId: true,
        game: { select: { platformGameId: true } },
      },
    });
  let reviews = await page(rotating ? blockedCursor : null);
  if (rotating && reviews.length < limit && blockedCursor) {
    // Bout de la liste : la tournée repart du début pour compléter la page.
    const seen = new Set(reviews.map((review) => review.id));
    const restart = (await page(null)).filter((review) => !seen.has(review.id));
    reviews = [...reviews, ...restart.slice(0, limit - reviews.length)];
  }
  if (rotating) blockedCursor = reviews.at(-1)?.id ?? null;
  for (const id of due ?? []) blockedReads.set(id, now);
  const byAccount = new Map<string, { userId: string; steamId: string; games: typeof reviews }>();
  for (const review of reviews) {
    const key = `${review.userId}:${review.steamId}`;
    const entry = byAccount.get(key) ?? {
      userId: review.userId!,
      steamId: review.steamId,
      games: [],
    };
    entry.games.push(review);
    byAccount.set(key, entry);
  }
  for (const { userId, steamId, games } of byAccount.values()) {
    const linked = await db.linkedAccount.findUnique({
      where: { provider_providerUserId: { provider: 'STEAM', providerUserId: steamId } },
      select: { userId: true },
    });
    // Le compte Steam a changé de main : la revue suit le compte, pas l'ancien joueur.
    if (linked?.userId !== userId) continue;
    const owned = await fetchOwnedApps(
      steamId,
      games.map((game) => Number(game.game.platformGameId)),
    ).catch(() => [] as OwnedGame[]);
    const sources = new Map(owned.map((game) => [String(game.appid), game]));
    for (const game of games) {
      const appId = game.game.platformGameId;
      try {
        const { unlocks, cleared } = await fetchUnlockList(steamId, Number(appId));
        const source = sources.get(appId);
        await saveProgress(
          userId,
          game.gameId,
          unlocks,
          {
            achievementsCheckedAt: new Date(),
            ...(source && {
              playtimeMinutes: source.playtime_forever ?? 0,
              offlinePlaytimeMinutes: source.playtime_disconnected ?? 0,
            }),
          },
          { steamId, complete: true, cleared },
        );
      } catch (cause) {
        if (!(cause instanceof SyncError)) log.error('Jeu bloqué :', cause);
      }
    }
  }
}

/** Revérifie quelques anciens lots à chaque passage, avec les heures fournies par Steam. */
export async function auditSteamHistory(limit = 24, userId?: string) {
  if (!availableProviders().STEAM) return;
  const games = await db.$queryRaw<
    { userId: string; steamId: string; gameId: string; appId: string }[]
  >`
    SELECT ug."userId", la."providerUserId" AS "steamId", ug."gameId", g."platformGameId" AS "appId"
    FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
    JOIN "LinkedAccount" la ON la."userId" = ug."userId" AND la.provider = 'STEAM'
    WHERE (${userId ?? null}::text IS NULL OR ug."userId" = ${userId ?? null}) AND g.platform = 'STEAM'
      AND (EXISTS (
        -- Les revues ouvertes avant le score de confiance sont relues une fois pour le calculer.
        SELECT 1 FROM "SteamIntegrityReview" r
        WHERE r."gameId" = g.id AND r."userId" = ug."userId" AND r.status = 'PENDING'
          AND r."suspendedAt" IS NULL AND r.trust IS NULL
      ) OR (ug."reportedUnlockedCount" IS NULL
      AND NOT g."allowSteamBatches" AND g.name NOT ILIKE 'Zup!%'
      AND g."platformGameId" <> '1258080' AND ug."unlockedCount" >= 8
      AND EXISTS (
        SELECT 1 FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE a."gameId" = g.id AND ua."userId" = ug."userId" AND ua."unlockedAt" > '2003-09-12'
        GROUP BY date_trunc('second', ua."unlockedAt")
        HAVING count(*) >= 20 OR count(*) >= greatest(10, ceil(g."totalAchievements" * 0.2))
          OR count(*) >= greatest(8, ceil(g."totalAchievements" * 0.65))
      ))
      -- Moins d'une minute de jeu par succès, sans lot : relu au plus une fois par semaine pour
      -- le contrôle du rythme (steamPaceSuspects), qui tranche avec la rareté et les pairs.
      -- Ou moins d'un dixième du temps complétionniste de Lure pour cette progression.
      OR (ug."unlockedCount" >= 10 AND ug."playtimeMinutes" > 0
        AND (ug."playtimeMinutes" < ug."unlockedCount" OR EXISTS (
          SELECT 1 FROM "LureGame" lg
          WHERE lg."steamAppId" = g."platformGameId" AND lg.found
            AND lg."completionistMinutes" >= 60 AND g."totalAchievements" > 0
            AND ug."playtimeMinutes" < 0.1 * lg."completionistMinutes"
              * least(1, ug."unlockedCount"::float / g."totalAchievements")
        ))
        AND NOT la."playtimeHidden" AND NOT g."allowSteamBatches" AND NOT g."crossProgress"
        AND g.name NOT ILIKE 'Zup!%' AND g."platformGameId" <> '1258080'
        AND (ug."achievementsCheckedAt" IS NULL
          OR ug."achievementsCheckedAt" < now() - interval '7 days')
        AND NOT EXISTS (
          SELECT 1 FROM "SteamIntegrityReview" r
          WHERE r."gameId" = g.id AND r."userId" = ug."userId"
            AND (r.status = 'PENDING' OR r."suspendedAt" IS NOT NULL)
        )))
    ORDER BY ug."achievementsCheckedAt" ASC NULLS FIRST, ug."gameId"
    LIMIT ${limit}`;
  for (const game of games) {
    const { userId, steamId } = game;
    const checked = new Date();
    try {
      const unlocks = await fetchUnlocks(steamId, Number(game.appId));
      await saveProgress(
        userId,
        game.gameId,
        unlocks,
        { achievementsCheckedAt: checked },
        {
          steamId,
          complete: true,
        },
      );
    } catch (cause) {
      // Un jeu illisible (succès devenus privés) passe derrière les autres : sans cela, il resterait
      // le plus ancien et reprendrait la tête de la liste à chaque passage.
      await db.userGame.updateMany({
        where: { userId, gameId: game.gameId },
        data: { achievementsCheckedAt: checked },
      });
      if (!(cause instanceof SyncError)) log.error('Contrôle des anciens succès Steam :', cause);
    }
  }
}

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
