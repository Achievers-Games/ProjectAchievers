import { PgBoss } from 'pg-boss';
import type { Provider } from '@prisma/client';
import { db } from '../db';
import { env } from '../env';
import { availableProviders } from '../providers';
import { fillFamilies } from '../family';
import { announceSeason } from '../push';
import { rateLimit } from '../rate-limit';
import { hasRecentFeat, isPublicGame, publicUser, RARE_CARD } from '../queries';
import { copiesFor, type Reward } from '$lib/collection';
import { fillWowCatalog, syncBlizzard } from './blizzard';
import { rateGames } from './content';
import { refreshDiscordAccounts } from './discord';
import { SyncError } from './errors';
import { publishCard, publishHighlight, publishSync, publishUnlock } from './events';
import { grantFrames } from '../frames';
import { checkSiteAchievements } from '../site-achievements';
import { syncPsn } from './psn';
import { syncRetro } from './retro';
import { fetchUnlocks, fillHiddenDescriptions, sweepSteamStore, syncSteam } from './steam';
import { fillGameTiers, saveProgress } from './store';
import { syncXbox } from './xbox';
import type { ProviderSync, UnlockedGame } from './types';

const SYNC_QUEUE = 'sync-account';
const SWEEP_QUEUE = 'sync-sweep';
const CONTENT_QUEUE = 'content-rating';
const STALE_AFTER = 24 * 60 * 60 * 1000;
const MAX_REWARDS = 10;
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
  game: Parameters<typeof isPublicGame>[0] & { tier: number | null };
};

interface SyncJob {
  userId: string;
  provider: Provider;
  /** Lancée sans que le joueur ne demande rien : pas de message s'il n'y a rien à annoncer. */
  quiet?: boolean;
}

const globalForBoss = globalThis as unknown as { paBoss?: Promise<PgBoss> };

function boss(): Promise<PgBoss> {
  return (globalForBoss.paBoss ??= (async () => {
    const instance = new PgBoss(env().DATABASE_URL);
    instance.on('error', (error) => console.error('pg-boss :', error));
    await instance.start();
    await instance.createQueue(SYNC_QUEUE);
    await instance.createQueue(SWEEP_QUEUE);
    await instance.createQueue(CONTENT_QUEUE);
    return instance;
  })());
}

export async function enqueueSync(userId: string, provider: Provider, quiet = false) {
  if (!SYNCERS[provider] || !availableProviders()[provider]) return false;

  // Une seule requête : deux clics simultanés ne peuvent pas lancer deux synchronisations.
  const { count } = await db.linkedAccount.updateMany({
    where: { userId, provider, syncStatus: { notIn: ['QUEUED', 'SYNCING'] } },
    data: { syncStatus: 'QUEUED', syncError: null },
  });
  if (count === 0) return false;

  publishSync(userId, { provider, status: 'QUEUED', processed: 0, total: 0 });

  const job: SyncJob = { userId, provider, quiet };
  await (await boss()).send(SYNC_QUEUE, job, { retryLimit: 1, retryDelay: 60 });
  return true;
}

/** Relance les comptes d'un joueur qui n'ont pas été lus depuis `cooldown`, échecs compris. */
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
      select: { provider: true },
    }),
    db.syncRun.groupBy({ by: ['provider'], where: { userId }, _max: { startedAt: true } }),
  ]);
  const lastRun = new Map(recent.map((run) => [run.provider, run._max.startedAt?.getTime() ?? 0]));
  const due = accounts.filter(
    ({ provider }) => Date.now() - (lastRun.get(provider) ?? 0) >= wait(provider),
  );
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
  if (rateLimit(`succes-site:${userId}`, 1, SITE_CHECK)) void reviewSiteAchievements(userId);
  void refreshAccounts(userId, autoInterval, true).catch((cause) =>
    console.error('Rafraîchissement :', cause),
  );
}

/** Un calcul de succès raté ne doit jamais faire échouer ce qui l'a déclenché. */
const reviewSiteAchievements = (userId: string) =>
  checkSiteAchievements(userId).catch((cause) => console.error('Succès du site :', cause));

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
    .catch((cause) => console.error('Fil global :', cause));
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
        copies: copiesFor(new Set(family.map(({ game }) => game.platform)).size),
      };
    })
    .filter(({ game }) => user.showAdult || !game.adultOnly);
  if (user.isPublic) {
    const { displayName, handle, avatarUrl, avatarMotionUrl, frame, frameMotionUrl } = user;
    for (const { game, unlockedAt } of rewards) {
      const recent = unlockedAt && Date.now() - unlockedAt.getTime() < LIVE_CARD_MAX_AGE;
      if (unlockedAt && recent && isPublicGame(game)) {
        publishCard({
          user: { displayName, handle, avatarUrl, avatarMotionUrl, frame, frameMotionUrl },
          game,
          unlockedAt,
        });
      }
    }
  }
  await grantFrames().catch((cause) => console.error('Cadres :', cause));
  return rewards;
}

/**
 * Relit un seul jeu, celui que le joueur a ouvert : les succès arrivent sur sa page en direct.
 * Un jeu encore inconnu attend la synchronisation complète, qui saura lire son catalogue.
 */
export async function runLiveGame(userId: string, steamId: string, appId: string) {
  const owned = await db.userGame.findFirst({
    where: { userId, game: { platform: 'STEAM', platformGameId: appId } },
    select: { unlockedCount: true, hidden: true, game: true },
  });
  if (!owned) return 0;

  const unlocks = await fetchUnlocks(steamId, Number(appId));
  if (unlocks.length <= owned.unlockedCount) return 0;

  const before = await rareCards(userId);
  const gained = await saveProgress(userId, owned.game.id, unlocks);
  if (gained === 0) return 0;

  const user = await syncUser(userId);
  if (!owned.hidden) announceUnlock(user, userId, owned.game, gained);
  const rewards = await announceCards(user, userId, before);
  publishSync(userId, {
    provider: 'STEAM',
    status: 'COMPLETED',
    processed: 1,
    total: 1,
    achievements: gained,
    quiet: true,
    rewards: rewards.slice(0, MAX_REWARDS),
    moreRewards: Math.max(0, rewards.length - MAX_REWARDS),
  });
  return gained;
}

export async function runSync({ userId, provider, quiet }: SyncJob) {
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

  const run = await db.syncRun.create({ data: { userId, provider, status: 'SYNCING' } });
  const hiddenGames = await db.userGame.findMany({
    where: { userId, hidden: true },
    select: { gameId: true },
  });
  const hidden = new Set(hiddenGames.map((row) => row.gameId));
  publishSync(userId, { provider, status: 'SYNCING', processed: 0, total: 0 });

  try {
    const before = await rareCards(userId);
    const result = await syncer({
      userId,
      account,
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
    const rewards = await announceCards(user, userId, before);
    publishSync(userId, {
      provider,
      status: 'COMPLETED',
      processed: result.games,
      total: result.games,
      achievements: result.achievements,
      quiet,
      rewards: rewards.slice(0, MAX_REWARDS),
      moreRewards: Math.max(0, rewards.length - MAX_REWARDS),
    });
    if (result.achievements > 0) await reviewSiteAchievements(userId);
  } catch (error) {
    const known = error instanceof SyncError;
    if (!known) console.error(`Synchronisation ${provider} :`, error);
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
    select: { userId: true, provider: true },
    take: 500,
  });
  for (const account of accounts) await enqueueSync(account.userId, account.provider);
  await announceSeason().catch((cause) => console.error('Annonce :', cause));
  await refreshDiscordAccounts().catch((cause) => console.error('Discord :', cause));
  await fillHiddenDescriptions().catch((cause) => console.error('Succès cachés :', cause));
  await fillWowCatalog().catch((cause) => console.error('Catalogue WoW :', cause));
  await sweepSteamStore().catch((cause) => console.error('Boutique Steam :', cause));
}

/** Démarre le traitement des synchronisations dans le processus du site. */
export async function startWorkers() {
  const instance = await boss();
  await fillFamilies();
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
  await instance.work(CONTENT_QUEUE, async () => void (await rateGames()));
  await instance.schedule(CONTENT_QUEUE, '*/5 * * * *');
}
