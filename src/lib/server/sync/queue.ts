import { PgBoss } from 'pg-boss';
import { backgroundWork } from '../workload';
import { invalidatePublicCache } from '../public-cache';
import type { Provider, SyncStatus } from '#prisma';
import { db } from '../db';
import { env } from '../env';
import { globals } from '../globals';
import { logger } from '#lib/logger';
import { availableProviders } from '../providers';
import { purgeAuthEvents } from '../auth-events';
import { warnStaleBackup } from '../backup-watch';
import { rewrapSecrets } from '../secret-rotation';
import { fillFamilies, matchFamilies } from '../family';
import { announceSeason } from '../push';
import { warnPsnToken } from '../service-token';
import { flagProfaneClans } from '../social';
import { checkAllClans } from '../clan-achievements';
import { rateLimit } from '../rate-limit';
import { hasRecentFeat, isPublicGame, publicUser, RARE_CARD } from '../queries';
import { copiesFor, copyKey, type Reward } from '#lib/collection';
import { fillWowCatalog, syncBlizzard } from './blizzard';
import { rateGames, tagGames } from './content';
import { refreshDiscordAccounts } from './discord';
import { SyncError } from './errors';
import { publishCard, publishChat, publishHighlight, publishSync, publishUnlock } from './events';
import { deliverPartnerWebhooks } from '../partner-webhooks';
import { grantFramesThrottled } from '../frames';
import { checkSiteAchievements, reviewNewPlayers } from '../site-achievements';
import { syncPsn } from './psn';
import { syncRetro } from './retro';
import {
  fetchTopGame,
  fetchUnlocks,
  fillHiddenDescriptions,
  refreshStaleSchemas,
  syncSteam,
  type TopGame,
} from './steam';
import { matchTopAchievements } from './steam-match';
import { fillGameTiers, recentUnlocks, saveProgress, type UnlockInput } from './store';
import { syncXbox } from './xbox';
import type { ProviderSync, UnlockedGame } from './types';

const SYNC_QUEUE = 'sync-account';
const SWEEP_QUEUE = 'sync-sweep';
const CONTENT_QUEUE = 'content-rating';
/** Les nouveaux succès des joueurs reliés, envoyés aux sites partenaires. */
const WEBHOOK_QUEUE = 'partner-webhooks';
/** Six heures, en secondes : assez pour le plus gros import, loin du plafond de 24 h de pg-boss. */
const JOB_EXPIRATION = 6 * 60 * 60;
const STALE_AFTER = 24 * 60 * 60 * 1000;
/** Une synchronisation échouée attend avant qu'une visite ne la remette en file. */
const FAILED_SYNC_COOLDOWN = 60 * 60 * 1000;
const MAX_REWARDS = 10;
/** Une rafale de succès ne doit pas noyer la page sous les annonces. */
const MAX_POPS = 5;
/** Au-delà, la carte est ancienne : lier un compte ne doit pas inonder le fil en direct. */
const LIVE_CARD_MAX_AGE = 48 * 60 * 60 * 1000;

const SYNCERS: Partial<Record<Provider, ProviderSync>> = {
  BLIZZARD: syncBlizzard,
  STEAM: syncSteam,
  PSN: syncPsn,
  RETRO: syncRetro,
  XBOX: syncXbox,
};

type CardReward = Reward & {
  game: Parameters<typeof isPublicGame>[0] & { tier: number | null; console?: string | null };
};

interface SyncJob {
  userId: string;
  provider: Provider;
  /** Lancée sans que le joueur ne demande rien : pas de message s'il n'y a rien à annoncer. */
  quiet?: boolean;
  /** Rattrapage horaire d'un joueur absent : il cède le pas à ceux qui sont sur le site. */
  background?: boolean;
}

const log = logger('Synchronisation');

function boss(): Promise<PgBoss> {
  return (globals.paBoss ??= (async () => {
    const instance = new PgBoss(env().DATABASE_URL);
    instance.on('error', (error) => log.error('pg-boss :', error));
    await instance.start();
    // pg-boss abandonne une tâche après 15 minutes par défaut, puis la rejoue : un premier import
    // sur le NAS dure bien plus longtemps et repartait alors de zéro. Les files déjà créées
    // gardent leurs anciens réglages, d'où la mise à jour après la création.
    for (const name of [SYNC_QUEUE, SWEEP_QUEUE, CONTENT_QUEUE, WEBHOOK_QUEUE]) {
      // Une synchronisation interrompue par un arrêt du serveur mérite un second essai ;
      // l'entretien, lui, revient de toute façon à l'heure suivante.
      const options = {
        expireInSeconds: JOB_EXPIRATION,
        retryLimit: name === SYNC_QUEUE ? 1 : 0,
      };
      await instance.createQueue(name, options);
      await instance.updateQueue(name, options);
    }
    return instance;
  })());
}

export async function enqueueSync(
  userId: string,
  provider: Provider,
  quiet = false,
  background = false,
) {
  if (!SYNCERS[provider] || !availableProviders()[provider]) return false;

  const instance = await boss();
  const job: SyncJob = { userId, provider, quiet, background };
  // L'état et la tâche sont validés ensemble, même si le processus s'arrête brutalement.
  const queued = await db.$transaction(async (tx) => {
    const { count } = await tx.linkedAccount.updateMany({
      where: { userId, provider, syncStatus: { notIn: ['QUEUED', 'SYNCING'] } },
      data: { syncStatus: 'QUEUED', syncError: null },
    });
    if (count === 0) return false;
    const id = await instance.send(SYNC_QUEUE, job, {
      retryLimit: 1,
      retryDelay: 60,
      // Une visite ou une demande explicite sort de la file avant le rattrapage des absents.
      priority: background ? 0 : 10,
      db: {
        executeSql: async (sql, values = []) => ({
          rows: await tx.$queryRawUnsafe(sql, ...values),
        }),
      },
    });
    if (!id) throw new Error('La tâche de synchronisation n’a pas été créée.');
    return true;
  });
  if (!queued) return false;
  publishSync(userId, { provider, status: 'QUEUED', processed: 0, total: 0 });
  return true;
}

/** Relance les comptes arrivés à échéance, avec une pause plus longue après un échec. */
export async function refreshAccounts(
  userId: string,
  cooldown: number | ((provider: Provider) => number),
  quiet = false,
  only?: Provider,
) {
  const wait = typeof cooldown === 'number' ? () => cooldown : cooldown;
  const providers = only ? [only] : (Object.keys(SYNCERS) as Provider[]);
  const [accounts, recent] = await Promise.all([
    db.linkedAccount.findMany({
      where: {
        userId,
        provider: { in: providers },
        syncStatus: { in: ['IDLE', 'COMPLETED', 'FAILED'] },
      },
      select: { provider: true, syncStatus: true },
    }),
    db.syncRun.groupBy({
      by: ['provider', 'status'],
      where: { userId },
      _max: { startedAt: true },
    }),
  ]);
  const lastRun = new Map<Provider, { startedAt: number; status: SyncStatus }>();
  for (const run of recent) {
    const startedAt = run._max.startedAt?.getTime() ?? 0;
    if (startedAt > (lastRun.get(run.provider)?.startedAt ?? 0)) {
      lastRun.set(run.provider, { startedAt, status: run.status });
    }
  }
  const now = Date.now();
  const due = accounts.filter(({ provider, syncStatus }) => {
    const last = lastRun.get(provider);
    const failed = syncStatus === 'FAILED' || last?.status === 'FAILED';
    const minimumWait = failed ? FAILED_SYNC_COOLDOWN : wait(provider);
    return now - (last?.startedAt ?? 0) >= minimumWait;
  });
  const started = await Promise.all(
    due.map((account) => enqueueSync(userId, account.provider, quiet)),
  );
  return started.filter(Boolean).length;
}

/**
 * Tous les délais de synchronisation complète, au même endroit. Steam n'en a pas besoin à la
 * visite : le suivi en direct (live.ts) relit toutes les 10 s le jeu en cours, rattrape à
 * l'arrivée les jeux dont le nombre de succès a bougé, et chacun passe chaque jour par la même
 * tournée. Les autres plateformes n'ont pas ce suivi : une visite les relit toutes les
 * 15 minutes, et le balayage horaire les rattrape une fois par jour.
 */
export const SYNC_DELAYS = {
  /** Le bouton du joueur, global ou par compte. */
  manual: 2 * 60 * 1000,
  /** Une visite, pour les plateformes sans suivi en direct. */
  visit: 15 * 60 * 1000,
} as const;
const visitInterval = (provider: Provider) =>
  provider === 'STEAM' ? Number.POSITIVE_INFINITY : SYNC_DELAYS.visit;
const RUN_HISTORY = 30 * 24 * 60 * 60 * 1000;
const MESSAGE_RETENTION = 365 * 24 * 60 * 60 * 1000;
const DELIVERED_EVENTS = 30 * 24 * 60 * 60 * 1000;
const RESOLVED_REPORTS = 180 * 24 * 60 * 60 * 1000;
const AUTO_CHECK = 60_000;
const SITE_CHECK = 10 * 60 * 1000;

/** À chaque visite, sans la ralentir : au plus une vérification par minute et par joueur. */
export function autoRefresh(userId: string) {
  if (!rateLimit(`rafraichissement:${userId}`, 1, AUTO_CHECK)) return;
  if (rateLimit(`succes-site:${userId}`, 1, SITE_CHECK)) {
    void backgroundWork('Succès du site', () => reviewSiteAchievements(userId), -1);
  }
  void refreshAccounts(userId, visitInterval, true).catch((cause) =>
    log.error('Rafraîchissement :', cause),
  );
}

/** Un calcul de succès raté ne doit jamais faire échouer ce qui l'a déclenché. */
const reviewSiteAchievements = (userId: string) =>
  checkSiteAchievements(userId).catch((cause) => log.error('Succès du site :', cause));

async function rareCards(userId: string) {
  const rows = await db.userGame.findMany({
    where: { userId, hidden: false, ...RARE_CARD },
    select: {
      gameId: true,
      unlockedCount: true,
      completion: true,
      platinum: true,
      lastUnlockedAt: true,
      game: {
        select: {
          name: true,
          slug: true,
          platform: true,
          console: true,
          headerUrl: true,
          totalAchievements: true,
          adultOnly: true,
          contentCheckedAt: true,
          familyKey: true,
          tier: true,
        },
      },
    },
  });
  return new Map(
    rows.map(({ gameId, game, lastUnlockedAt, ...progress }): [string, CardReward] => [
      gameId,
      { game, progress, unlockedAt: lastUnlockedAt },
    ]),
  );
}

/** Cartes apparues depuis `before`. */
/** Les cartes annoncées il y a peu, par joueur et par jeu. */
const announced = new Map<string, number>();
const ANNOUNCED_FOR = 10 * 60_000;

/**
 * Deux synchronisations d'un même joueur peuvent alterner (elles rendent leur créneau tous les
 * vingt jeux) : la carte gagnée par l'une figure alors aussi dans le relevé final de l'autre.
 * Elle ne se révèle qu'une fois.
 */
function firstAnnouncement(userId: string, gameId: string, now = Date.now()) {
  if (announced.size > 5_000) {
    for (const [key, at] of announced) if (now - at > ANNOUNCED_FOR) announced.delete(key);
  }
  const key = `${userId}:${gameId}`;
  const last = announced.get(key);
  if (last !== undefined && now - last <= ANNOUNCED_FOR) return false;
  announced.set(key, now);
  return true;
}

function newRewards(
  userId: string,
  before: Map<string, CardReward>,
  after: Map<string, CardReward>,
) {
  return [...after]
    .filter(([id]) => !before.has(id) && firstAnnouncement(userId, id))
    .map(([, card]) => card);
}

const syncUser = (userId: string) =>
  db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...publicUser, isPublic: true, showAdult: true },
  });

type SyncUser = Awaited<ReturnType<typeof syncUser>>;

function announceUnlock(user: SyncUser, userId: string, game: UnlockedGame, count: number) {
  if (!user.isPublic || !isPublicGame(game)) return;
  void hasRecentFeat(userId, game.id, new Date(Date.now() - LIVE_CARD_MAX_AGE))
    .then((feat) => feat && publishHighlight())
    .catch((cause) => log.error('Fil global :', cause));
  publishUnlock({
    user: user.displayName,
    handle: user.handle,
    avatarUrl: user.avatarUrl,
    avatarMotionUrl: user.avatarMotionUrl,
    frame: user.frame,
    frameMotionUrl: user.frameMotionUrl,
    game: game.name,
    gameSlug: game.slug,
    count,
  });
}

/** Annonce les cartes apparues depuis `before` et renvoie celles à révéler au joueur. */
async function announceCards(user: SyncUser, userId: string, before: Map<string, CardReward>) {
  const after = await rareCards(userId);
  const families = Map.groupBy(after.values(), ({ game }) => game.familyKey ?? game.slug);
  const rewards = newRewards(userId, before, after)
    .map((card) => {
      const family = families.get(card.game.familyKey ?? card.game.slug) ?? [card];
      return {
        ...card,
        tier: Math.max(...family.map(({ game }) => game.tier ?? 1)),
        copies: copiesFor(new Set(family.map(({ game }) => copyKey(game))).size),
      };
    })
    .filter(({ game }) => user.showAdult || !game.adultOnly);
  if (user.isPublic) {
    const { displayName, handle, avatarUrl, avatarMotionUrl, frame, frameMotionUrl } = user;
    for (const { game, unlockedAt, copies, tier } of rewards) {
      const recent = unlockedAt && Date.now() - unlockedAt.getTime() < LIVE_CARD_MAX_AGE;
      if (unlockedAt && recent && isPublicGame(game)) {
        publishCard({
          user: { displayName, handle, avatarUrl, avatarMotionUrl, frame, frameMotionUrl },
          game: { ...game, tier },
          copies,
          unlockedAt,
        });
      }
    }
  }
  await grantFramesThrottled().catch((cause) => log.error('Cadres :', cause));
  return rewards;
}

/**
 * Les jeux dont un succès est daté à sa détection, en attendant l'heure exacte que
 * GetPlayerAchievements donne de 40 s à 5 min plus tard. Au-delà d'une demi-heure, la date
 * provisoire reste : elle n'est fausse que de quelques secondes.
 */
const provisional = new Map<string, number>();
const PROVISIONAL_FOR = 30 * 60_000;

function awaitingExactDates(key: string, now = Date.now()) {
  for (const [entry, at] of provisional) if (now - at > PROVISIONAL_FOR) provisional.delete(entry);
  return provisional.has(key);
}

/**
 * Relit un seul jeu, celui que le joueur a ouvert : les succès arrivent sur sa page en direct.
 * GetTopAchievementsForGames voit un succès quelques secondes après son déblocage : il est
 * reconnu (steam-match.ts), enregistré et annoncé aussitôt, puis daté exactement dès que
 * GetPlayerAchievements le voit à son tour. Sans réponse de la première, seule la seconde sert.
 * `top` évite de redemander à Steam ce que le rattrapage vient de lire.
 */
export async function runLiveGame(
  userId: string,
  steamId: string,
  appId: string,
  playtimeMinutes?: number,
  prefetched?: TopGame,
) {
  const owned = await db.userGame.findFirst({
    where: { userId, game: { platform: 'STEAM', platformGameId: appId } },
    select: { unlockedCount: true, hidden: true, game: true },
  });
  // `null` : le jeu n'est pas encore au profil, le suivi en direct le fait importer.
  if (!owned) return null;

  const key = `${userId}:${owned.game.id}`;
  const pending = awaitingExactDates(key);
  const top =
    prefetched ??
    (await fetchTopGame(steamId, Number(appId)).catch((cause: unknown) => {
      log.error('Succès en direct Steam :', cause);
      return null;
    }));
  // Rien de plus chez Steam que dans la base : un seul appel, et rien d'autre à faire.
  const moved = !top || top.achievements.length > owned.unlockedCount || pending;
  let unlocks: UnlockInput[] = moved ? await fetchUnlocks(steamId, Number(appId)) : [];
  if (moved && top && top.achievements.length > unlocks.length) {
    // Steam voit déjà ce que GetPlayerAchievements ne montre pas encore : daté à sa détection.
    const exact = new Set(unlocks.map((unlock) => unlock.platformAchievementId));
    const matched = await matchTopAchievements(owned.game.id, top.achievements);
    const now = new Date();
    const early = [...new Set(matched.values())]
      .filter((id) => !exact.has(id))
      .map((platformAchievementId) => ({ platformAchievementId, unlockedAt: now }));
    if (early.length) provisional.set(key, Date.now());
    unlocks = [...unlocks, ...early];
  } else if (pending) {
    // GetPlayerAchievements a rattrapé : ses dates exactes remplacent les dates provisoires.
    provisional.delete(key);
    await saveProgress(userId, owned.game.id, unlocks);
  }

  if (unlocks.length <= owned.unlockedCount) {
    // Le temps de jeu a bougé sans nouveau succès : on le retient, sinon la relecture des jeux
    // récents redemanderait ce jeu à chaque passage.
    await db.userGame.updateMany({
      where: { userId, gameId: owned.game.id },
      data: {
        ...(playtimeMinutes !== undefined && { playtimeMinutes }),
        achievementsCheckedAt: new Date(),
      },
    });
    return 0;
  }

  const before = await rareCards(userId);
  const { gained, fresh } = await saveProgress(userId, owned.game.id, unlocks, {
    ...(playtimeMinutes !== undefined && { playtimeMinutes }),
    achievementsCheckedAt: new Date(),
  });
  if (gained === 0) return 0;
  invalidatePublicCache();

  const achievements = fresh.slice(0, MAX_POPS).map(({ id, name, iconUrl }) => ({
    id,
    title: name,
    icon: iconUrl,
    game: owned.game.name,
  }));
  if (achievements.length) publishChat(userId, { type: 'unlocks', achievements });

  const user = await syncUser(userId);
  if (!owned.hidden) announceUnlock(user, userId, owned.game, gained);
  const rewards = await announceCards(user, userId, before);
  publishSync(userId, {
    provider: 'STEAM',
    status: 'COMPLETED',
    processed: 1,
    total: 1,
    achievements: gained,
    // Le joueur a la page ouverte : chaque succès s'y fête tout de suite, sans rechargement.
    unlocks: achievements,
    quiet: true,
    rewards: rewards.slice(0, MAX_REWARDS),
    moreRewards: Math.max(0, rewards.length - MAX_REWARDS),
  });
  return gained;
}

export function runSync(job: SyncJob) {
  return backgroundWork(
    `Synchronisation ${job.provider}`,
    (yieldSlot) => runAccountSync(job, yieldSlot).finally(invalidatePublicCache),
    // Même ordre dans le budget de fond : présent, puis absent, puis entretien.
    job.background ? 0 : 1,
  );
}

async function runAccountSync(
  { userId, provider, quiet }: SyncJob,
  yieldSlot: () => Promise<void>,
) {
  const syncer = SYNCERS[provider];
  if (!syncer) return;

  const where = { userId_provider: { userId, provider } };
  const account = await db.linkedAccount.findUnique({ where });
  if (!account) return;

  const user = await syncUser(userId);
  // Une seule requête : une tâche restée en file ne double jamais une synchronisation en cours.
  const { count } = await db.linkedAccount.updateMany({
    where: { userId, provider, syncStatus: { not: 'SYNCING' } },
    data: { syncStatus: 'SYNCING', syncError: null },
  });
  if (count === 0) return;

  // Le compte est déjà marqué en cours : un échec ici ne doit pas l'y laisser jusqu'au redémarrage.
  const run = await db.syncRun
    .create({ data: { userId, provider, status: 'SYNCING' } })
    .catch(async (cause: unknown) => {
      await db.linkedAccount.update({
        where,
        data: { syncStatus: 'FAILED', syncError: 'sync_failed_retry' },
      });
      throw cause;
    });
  publishSync(userId, { provider, status: 'SYNCING', processed: 0, total: 0 });

  try {
    const hiddenGames = await db.userGame.findMany({
      where: { userId, hidden: true },
      select: { gameId: true },
    });
    const hidden = new Set(hiddenGames.map((row) => row.gameId));
    const before = await rareCards(userId);
    const result = await syncer({
      userId,
      account,
      yieldSlot,
      report: (processed, total, game) =>
        publishSync(userId, { provider, status: 'SYNCING', processed, total, game }),
      onUnlocked: (game, count) => {
        if (!hidden.has(game.id)) announceUnlock(user, userId, game, count);
      },
    });

    const finishedAt = new Date();
    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', ...result, finishedAt },
      }),
      db.linkedAccount.update({
        where,
        data: { syncStatus: 'COMPLETED', lastSyncedAt: finishedAt },
      }),
    ]);
    // Le premier import d'un compte rapporte tout son passé : ce ne sont pas des nouvelles, et la
    // cloche ne doit pas en annoncer des centaines. Ils arrivent à leur date de déblocage, y
    // compris ceux qu'un premier essai interrompu avait déjà enregistrés.
    if (!account.lastSyncedAt) {
      await db.$executeRaw`
        UPDATE "UserAchievement" ua SET "createdAt" = ua."unlockedAt"
        FROM "Achievement" a JOIN "Game" g ON g.id = a."gameId"
        WHERE ua."achievementId" = a.id AND ua."userId" = ${userId}
          AND g.platform = CAST(${provider} AS "Platform")`;
    }
    const rewards = await announceCards(user, userId, before);
    if (result.achievements > 0) await reviewSiteAchievements(userId);
    publishSync(userId, {
      provider,
      status: 'COMPLETED',
      processed: result.games,
      total: result.games,
      achievements: result.achievements,
      // Revenu sur le site après avoir joué : les succès tombés entre-temps se fêtent ici.
      unlocks: result.achievements > 0 ? await recentUnlocks(userId) : undefined,
      quiet,
      rewards: rewards.slice(0, MAX_REWARDS),
      moreRewards: Math.max(0, rewards.length - MAX_REWARDS),
    });
  } catch (error) {
    const known = error instanceof SyncError;
    if (!known) log.error(`Synchronisation ${provider} :`, error);
    const message = known ? error.message : 'sync_failed_retry';
    const status = known && error.needsRelink ? 'NEEDS_RELINK' : 'FAILED';

    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      }),
      db.linkedAccount.update({ where, data: { syncStatus: status, syncError: message } }),
    ]);
    publishSync(userId, { provider, status, processed: 0, total: 0, error: message, quiet });
  }
}

/**
 * Découpe un entretien long en petits lots, chacun rendant le budget de fond : ces tâches
 * dorment entre deux appels aux plateformes, et un import demandé par un joueur attendait
 * sinon plusieurs minutes derrière elles. Un lot incomplet veut dire qu'il ne reste rien, ou
 * que la plateforme a dit stop.
 */
async function inSlices(
  name: string,
  slices: number,
  size: number,
  run: (limit: number) => Promise<number>,
) {
  for (let slice = 0; slice < slices; slice++) {
    if ((await backgroundWork(name, () => run(size), -1)) < size) return;
  }
}

/** Ce qui a fait son temps : chaque table a sa durée de conservation. */
async function purgeExpired(now: Date) {
  const before = (age: number) => ({ lt: new Date(now.getTime() - age) });
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.psnVerification.deleteMany({ where: { expiresAt: { lt: now } } });
  await purgeAuthEvents(now);
  // Un jeton expiré ne sert plus à rien, même pour repérer un réemploi : il est refusé à sa date.
  await db.oAuthToken.deleteMany({ where: { expiresAt: before(STALE_AFTER) } });
  await db.partnerEvent.deleteMany({ where: { deliveredAt: before(DELIVERED_EVENTS) } });
  // Les signalements retenus restent : ils comptent pour un succès du site.
  await db.report.deleteMany({ where: { upheld: false, resolvedAt: before(RESOLVED_REPORTS) } });
  await db.syncRun.deleteMany({ where: { startedAt: before(RUN_HISTORY) } });
  await db.message.deleteMany({ where: { createdAt: before(MESSAGE_RETENTION) } });
}

/**
 * Les comptes que personne n'a synchronisés depuis un jour, les plus en retard d'abord.
 * Un échec ne touche pas `lastSyncedAt` : sans ce garde-fou, un profil privé repartait à chaque
 * heure, sans fin. Un compte en échec n'est relancé d'ici qu'une fois par jour. Le filtre est
 * fait par la base : écartés après coup, les échecs occupaient des places du lot, et un compte
 * au-delà des 500 premiers pouvait n'être jamais relu.
 */
export function staleAccounts(now: Date, limit = 500) {
  const stale = new Date(now.getTime() - STALE_AFTER);
  const providers = Object.keys(SYNCERS);
  return db.$queryRaw<
    {
      userId: string;
      provider: Provider;
      syncStatus: SyncStatus;
      lastSyncedAt: Date | null;
    }[]
  >`
    SELECT la."userId", la.provider, la."syncStatus", la."lastSyncedAt"
    FROM "LinkedAccount" la
    WHERE la.provider::text = ANY(${providers}::text[])
      AND la."syncStatus" IN ('IDLE', 'COMPLETED', 'FAILED')
      AND (la."lastSyncedAt" IS NULL OR la."lastSyncedAt" < ${stale})
      AND NOT (
        la."syncStatus" = 'FAILED' AND EXISTS (
          SELECT 1 FROM "SyncRun" r
          WHERE r."userId" = la."userId" AND r.provider = la.provider AND r."startedAt" >= ${stale}
        )
      )
    ORDER BY la."lastSyncedAt" ASC NULLS FIRST
    LIMIT ${limit}`;
}

/** Relit les comptes que personne n'a synchronisés depuis un jour. */
async function requeueStaleAccounts(now: Date) {
  for (const account of await staleAccounts(now)) {
    // Steam a sa tournée légère, la même que pour un joueur présent : la synchronisation
    // complète ne sert qu'au premier import, et à reprendre un compte en échec.
    if (account.provider === 'STEAM' && account.lastSyncedAt && account.syncStatus !== 'FAILED') {
      await steamPass(account.userId);
      continue;
    }
    // Personne n'a rien demandé : pas de relecture forcée, ni de message sans nouveauté.
    await enqueueSync(account.userId, account.provider, true, true);
  }
}

/** Un échec est journalisé : le compte repassera le lendemain. */
async function steamPass(userId: string) {
  // Import différé : le suivi en direct dépend lui-même de cette file.
  const { steamDailyPass } = await import('./live');
  try {
    await backgroundWork('Tournée Steam', () => steamDailyPass(userId), 0);
    await db.linkedAccount.updateMany({
      where: { userId, provider: 'STEAM' },
      data: { lastSyncedAt: new Date() },
    });
  } catch (cause) {
    log.error('Tournée Steam :', cause);
  }
}

/**
 * L'entretien horaire, dans l'ordre. Chaque tâche rend le budget de fond en finissant, et son
 * échec est journalisé sans arrêter les suivantes. Celles qui s'exécutent hors budget le gèrent
 * elles-mêmes (le balayage de la boutique le rend à chaque page) ou ne font qu'une lecture.
 */
const MAINTENANCE: { label: string; run: () => Promise<unknown>; budget?: false }[] = [
  { label: 'Succès du site', run: () => reviewNewPlayers() },
  { label: 'Annonce', run: () => announceSeason() },
  { label: 'Jeton PSN', run: () => warnPsnToken() },
  { label: 'Sauvegarde', run: () => warnStaleBackup(), budget: false },
  { label: 'Chiffrement', run: () => rewrapSecrets(), budget: false },
  { label: 'Noms de clan', run: () => flagProfaneClans() },
  { label: 'Succès de clan', run: () => checkAllClans() },
  {
    label: 'Discord',
    run: () => inSlices('Discord', 5, 20, (limit) => refreshDiscordAccounts(undefined, limit)),
    budget: false,
  },
  {
    label: 'Succès cachés',
    // Le nombre rendu est celui des jeux complétés : un lot qui n'apporte rien arrête la série.
    run: () => inSlices('Succès cachés', 3, 1, () => fillHiddenDescriptions(20)),
    budget: false,
  },
  {
    label: 'Listes Steam',
    // Dix jeux par lot, trois lots par heure : 720 jeux par jour, de quoi relire chaque jeu
    // possédé au moins une fois par semaine tant que le catalogue reste sous les 5 000 jeux.
    run: () => inSlices('Listes Steam', 3, 10, (limit) => refreshStaleSchemas(limit)),
    budget: false,
  },
  { label: 'Catalogue WoW', run: () => fillWowCatalog() },
  { label: 'Familles', run: () => matchFamilies() },
];

async function sweep() {
  const now = new Date();
  await purgeExpired(now);
  await requeueStaleAccounts(now);
  for (const { label, run, budget } of MAINTENANCE) {
    await (budget === false ? run() : backgroundWork(label, run, -1)).catch((cause) =>
      log.error(`${label} :`, cause),
    );
  }
}

/** Rend les tâches en cours à la file avant l'arrêt : elles repartiront au prochain démarrage. */
export async function stopWorkers() {
  const instance = await globals.paBoss?.catch(() => undefined);
  await instance?.stop({ graceful: false, timeout: 5_000 });
}

/** Démarre le traitement des synchronisations dans le processus du site. */
export async function startWorkers() {
  const instance = await boss();
  await fillFamilies();
  await matchFamilies().catch((cause) => log.error('Familles :', cause));
  await fillGameTiers();

  // Un arrêt brutal peut laisser des comptes bloqués en cours de synchronisation.
  await db.linkedAccount.updateMany({
    where: { syncStatus: { in: ['QUEUED', 'SYNCING'] } },
    data: { syncStatus: 'IDLE' },
  });
  await db.syncRun.updateMany({
    where: { status: 'SYNCING' },
    data: { status: 'FAILED', error: 'sync_failed_retry', finishedAt: new Date() },
  });

  await instance.work<SyncJob>(
    SYNC_QUEUE,
    // Garde des comptes prêts à reprendre le créneau rendu entre deux lots.
    { localConcurrency: env().SYNC_CONCURRENCY + 2 },
    async (jobs) => {
      for (const job of jobs) await runSync(job.data);
    },
  );
  await instance.work(SWEEP_QUEUE, async () => sweep());
  await instance.schedule(SWEEP_QUEUE, '0 * * * *');
  await instance.work(CONTENT_QUEUE, async () => {
    await inSlices('Classification des jeux', 15, 10, (limit) => rateGames(limit));
    await inSlices('Genres des jeux', 10, 30, (limit) => tagGames(limit));
  });
  await instance.schedule(CONTENT_QUEUE, '*/5 * * * *');
  // File indépendante, mais le même budget de fond protège la mémoire du NAS.
  await instance.work(WEBHOOK_QUEUE, async () =>
    backgroundWork('Webhooks partenaires', () => deliverPartnerWebhooks(), -1),
  );
  await instance.schedule(WEBHOOK_QUEUE, '* * * * *');
}
