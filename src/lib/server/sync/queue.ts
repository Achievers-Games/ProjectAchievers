import { PgBoss } from 'pg-boss';
import { backgroundWork } from '../workload';
import { invalidatePublicCache } from '../public-cache';
import type { Provider, SyncStatus } from '#prisma';
import { db } from '../db';
import { env } from '../env';
import { globals } from '../globals';
import { logger } from '#lib/logger';
import { availableProviders } from '../providers';
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
import { publishCard, publishHighlight, publishSync, publishUnlock } from './events';
import { deliverPartnerWebhooks } from '../partner-webhooks';
import { grantFramesThrottled } from '../frames';
import { checkSiteAchievements, reviewNewPlayers } from '../site-achievements';
import { syncPsn } from './psn';
import { syncRetro } from './retro';
import { fetchUnlocks, fillHiddenDescriptions, sweepSteamStore, syncSteam } from './steam';
import { fillGameTiers, recentUnlocks, saveProgress } from './store';
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

export async function enqueueSync(userId: string, provider: Provider, quiet = false) {
  if (!SYNCERS[provider] || !availableProviders()[provider]) return false;

  const instance = await boss();
  const job: SyncJob = { userId, provider, quiet };
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
) {
  const wait = typeof cooldown === 'number' ? () => cooldown : cooldown;
  const providers = Object.keys(SYNCERS) as Provider[];
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

/** L'API Steam est officielle ; PSN passe par un compte de service unique, à ménager. */
const autoInterval = (provider: Provider) => (provider === 'STEAM' ? 5 : 15) * 60 * 1000;
const RUN_HISTORY = 30 * 24 * 60 * 60 * 1000;
const MESSAGE_RETENTION = 365 * 24 * 60 * 60 * 1000;
const AUTO_CHECK = 60_000;
const SITE_CHECK = 10 * 60 * 1000;

/** À chaque visite, sans la ralentir : au plus une vérification par minute et par joueur. */
export function autoRefresh(userId: string) {
  if (!rateLimit(`rafraichissement:${userId}`, 1, AUTO_CHECK)) return;
  if (rateLimit(`succes-site:${userId}`, 1, SITE_CHECK)) {
    void backgroundWork('Succès du site', () => reviewSiteAchievements(userId), -1);
  }
  void refreshAccounts(userId, autoInterval, true).catch((cause) =>
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
function newRewards(before: Map<string, CardReward>, after: Map<string, CardReward>) {
  return [...after].filter(([id]) => !before.has(id)).map(([, card]) => card);
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
  const rewards = newRewards(before, after)
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
 * Relit un seul jeu, celui que le joueur a ouvert : les succès arrivent sur sa page en direct.
 * Un jeu encore inconnu attend la synchronisation complète, qui saura lire son catalogue.
 */
export async function runLiveGame(
  userId: string,
  steamId: string,
  appId: string,
  playtimeMinutes?: number,
) {
  const owned = await db.userGame.findFirst({
    where: { userId, game: { platform: 'STEAM', platformGameId: appId } },
    select: { unlockedCount: true, hidden: true, game: true },
  });
  if (!owned) return 0;

  const unlocks = await fetchUnlocks(steamId, Number(appId));
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
    unlocks: fresh.slice(0, MAX_POPS).map(({ id, name, iconUrl }) => ({
      id,
      title: name,
      icon: iconUrl,
      game: owned.game.name,
    })),
    quiet: true,
    rewards: rewards.slice(0, MAX_REWARDS),
    moreRewards: Math.max(0, rewards.length - MAX_REWARDS),
  });
  return gained;
}

export function runSync(job: SyncJob) {
  return backgroundWork(
    `Synchronisation ${job.provider}`,
    () => runAccountSync(job).finally(invalidatePublicCache),
    1,
  );
}

async function runAccountSync({ userId, provider, quiet }: SyncJob) {
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
      force: !quiet,
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

async function sweep() {
  const now = new Date();
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.psnVerification.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.syncRun.deleteMany({
    where: { startedAt: { lt: new Date(now.getTime() - RUN_HISTORY) } },
  });
  await db.message.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - MESSAGE_RETENTION) } },
  });

  const accounts = await db.linkedAccount.findMany({
    where: {
      provider: { in: Object.keys(SYNCERS) as Provider[] },
      syncStatus: { in: ['IDLE', 'COMPLETED', 'FAILED'] },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - STALE_AFTER) } }],
    },
    select: { userId: true, provider: true, syncStatus: true },
    take: 500,
  });
  // Un échec ne touche pas `lastSyncedAt` : sans ce garde-fou, un profil privé repartait à chaque
  // heure, sans fin. Un compte en échec n'est relancé d'ici qu'une fois par jour.
  const failed = accounts.filter((account) => account.syncStatus === 'FAILED');
  const retried = failed.length
    ? await db.syncRun.groupBy({
        by: ['userId', 'provider'],
        where: {
          userId: { in: failed.map((account) => account.userId) },
          startedAt: { gte: new Date(now.getTime() - STALE_AFTER) },
        },
      })
    : [];
  const recent = new Set(retried.map((run) => `${run.userId}:${run.provider}`));
  for (const account of accounts) {
    if (account.syncStatus === 'FAILED' && recent.has(`${account.userId}:${account.provider}`)) {
      continue;
    }
    // Personne n'a rien demandé : pas de relecture forcée, ni de message sans nouveauté.
    await enqueueSync(account.userId, account.provider, true);
  }
  await backgroundWork('reviewNewPlayers', () => reviewNewPlayers(), -1).catch((cause) =>
    log.error('Succès du site :', cause),
  );
  await backgroundWork('announceSeason', () => announceSeason(), -1).catch((cause) =>
    log.error('Annonce :', cause),
  );
  await backgroundWork('warnPsnToken', () => warnPsnToken(), -1).catch((cause) =>
    log.error('Jeton PSN :', cause),
  );
  await backgroundWork('flagProfaneClans', () => flagProfaneClans(), -1).catch((cause) =>
    log.error('Noms de clan :', cause),
  );
  await backgroundWork('checkAllClans', () => checkAllClans(), -1).catch((cause) =>
    log.error('Succès de clan :', cause),
  );
  await inSlices('refreshDiscordAccounts', 5, 20, (limit) =>
    refreshDiscordAccounts(undefined, limit),
  ).catch((cause) => log.error('Discord :', cause));
  // Le nombre rendu est celui des jeux complétés : un lot qui n'apporte rien arrête la série.
  await inSlices('fillHiddenDescriptions', 3, 1, () => fillHiddenDescriptions(20)).catch((cause) =>
    log.error('Succès cachés :', cause),
  );
  await backgroundWork('fillWowCatalog', () => fillWowCatalog(), -1).catch((cause) =>
    log.error('Catalogue WoW :', cause),
  );
  await sweepSteamStore().catch((cause) => log.error('Boutique Steam :', cause));
  await backgroundWork('matchFamilies', () => matchFamilies(), -1).catch((cause) =>
    log.error('Familles :', cause),
  );
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
    { localConcurrency: env().SYNC_CONCURRENCY },
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
