import type { Locale } from '#lib/paraglide/runtime';
import type { AchievementText } from '../achievement-texts';
import type { BlizzardCharacter } from '../accounts';
import { db } from '../db';
import { logger } from '#lib/logger';
import { blizzardGet } from '../providers/blizzard';

const log = logger('WoW');
import { mapLimit, syncGames } from './errors';
import {
  saveAchievements,
  refreshGameTier,
  saveProgress,
  upsertGame,
  type AchievementInput,
  type UnlockInput,
} from './store';
import type { ProviderSync, SyncContext } from './types';

export const WOW_GAME = 'wow';
export const SC2_GAME = 'sc2';

const CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 8;
const CATALOG_MAX_AGE = 7 * 86_400_000;
/** Blizzard compte les requêtes à l'heure : le catalogue WoW se remplit par morceaux. */
const DETAILS_PER_RUN = 3_000;
/** Les serveurs européens : le catalogue est le même partout. */
const SC2_REGION = 2;

const WOW_NAME = 'World of Warcraft';
const SC2_NAME = 'StarCraft II';

/** Battle.net ne donne pas d'image de jeu : les visuels officiels des sites de Blizzard. */
const ART = 'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec';
const WOW_IMAGE = `${ART}/bltb5a24e5ab1e2cfb0/6a88e3589b942efdb6f74110/wow-thumbnail-homepage.jpg`;
const SC2_IMAGE = `${ART}/bltbe2068a317e02d9f/6966bac0fb2fd910dbda4a26/og_image.webp`;

/** Blizzard ne traduit pas ces succès en japonais : l'anglais y remplace le français stocké. */
const LOCALES: Record<Exclude<Locale, 'fr'>, string> = {
  en: 'en_GB',
  de: 'de_DE',
  es: 'es_ES',
  'pt-BR': 'pt_BR',
  ru: 'ru_RU',
  'zh-CN': 'zh_CN',
  ja: 'en_GB',
};
const BASE_LOCALE = 'fr_FR';

type Texts = Record<string, string>;

interface WowEarned {
  id: number;
  completed_timestamp?: number;
}

export interface Sc2Earned {
  achievementId: string;
  completionDate?: number;
  isComplete?: boolean;
}

export interface Sc2Achievement {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  points?: number;
}

/** Le champ `criteria` peut dire « non terminé » sur un succès daté : seule la date compte. */
export const wowUnlocks = (achievements: WowEarned[]): UnlockInput[] =>
  achievements.flatMap((a) =>
    a.completed_timestamp
      ? [{ platformAchievementId: String(a.id), unlockedAt: new Date(a.completed_timestamp) }]
      : [],
  );

export const sc2Unlocks = (achievements: Sc2Earned[]): UnlockInput[] =>
  achievements.flatMap((a) =>
    a.isComplete && a.completionDate
      ? [
          {
            platformAchievementId: a.achievementId,
            unlockedAt: new Date(a.completionDate * 1000),
          },
        ]
      : [],
  );

/** Réunit plusieurs personnages en un seul joueur : un succès garde sa première date. */
export function mergeUnlocks(lists: UnlockInput[][]): UnlockInput[] {
  const merged = new Map<string, Date>();
  for (const { platformAchievementId: id, unlockedAt } of lists.flat()) {
    const known = merged.get(id);
    if (!known || unlockedAt < known) merged.set(id, unlockedAt);
  }
  return [...merged].map(([platformAchievementId, unlockedAt]) => ({
    platformAchievementId,
    unlockedAt,
  }));
}

/** Noms techniques de Blizzard, repérés en anglais : « Day9VoicePackPurchase », « Nova Criteria 1 ». */
const SC2_INTERNAL =
  /Criteria \d|%userName%|Achievement\/|_|Temp Tournament|Global Invitational|[a-z][A-Z]/;
/** Les vrais noms où deux majuscules se suivent ainsi. */
const SC2_BRANDS =
  /StarCraft|StarJeweled|WarCraft|BlizzCon|DreamHack|HotS|LotV|WoL|MinedCraft|StarTours/g;

/**
 * Le catalogue mêle les succès à des récompenses internes (portraits, achats, à zéro point),
 * et certaines fiches ont le titre d'une autre : une vraie fiche a un titre court, sans point
 * final, et une description rédigée en phrase. Comparé au wiki StarCraft : 623 fiches gardées
 * y figurent, les hauts faits à zéro point restent écartés car trop mêlés aux achats.
 */
export function isRealSc2Achievement({ title, description = '', points }: Sc2Achievement) {
  const text = `${title} ${description}`.replace(SC2_BRANDS, '');
  return (
    Boolean(points) &&
    !SC2_INTERNAL.test(text) &&
    !/[a-z]\.$/.test(title) &&
    !/^[a-z]+\d+$/.test(title) &&
    (/[.!?"”)]$/.test(description.trim()) || description.trim().split(/\s+/).length >= 6)
  );
}

export const mapSc2Achievement = (a: Sc2Achievement): AchievementInput => ({
  platformAchievementId: a.id,
  name: a.title,
  description: a.description ?? '',
  iconUrl: a.imageUrl ?? null,
  iconLockedUrl: a.imageUrl ?? null,
  hidden: false,
  trophyType: 'ACHIEVEMENT',
  points: a.points ?? 0,
});

const STATIC = { namespace: 'static-eu' };

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Blizzard a répondu ${response.status}`);
  return (await response.json()) as T;
}

/** Les succès de guilde ne s'obtiennent pas seul : ils ne comptent pas dans le total. */
async function fetchWowCatalog() {
  const { categories, guild_categories: guild = [] } = await readJson<{
    categories: { id: number }[];
    guild_categories?: { id: number }[];
  }>(await blizzardGet('/data/wow/achievement-category/index', STATIC));
  const excluded = new Set(guild.map((category) => category.id));
  const names = new Map<number, string>();
  await mapLimit(
    categories.filter((category) => !excluded.has(category.id)),
    DETAIL_CONCURRENCY,
    async ({ id }) => {
      const { achievements = [] } = await readJson<{
        achievements?: { id: number; name: Texts }[];
      }>(await blizzardGet(`/data/wow/achievement-category/${id}`, STATIC));
      for (const a of achievements) names.set(a.id, a.name[BASE_LOCALE] ?? '');
    },
  );
  return names;
}

/** Les noms d'abord, en une fois ; description et icône demandent une requête par succès. */
async function refreshWowCatalog() {
  const game = await upsertGame({
    platform: 'BLIZZARD',
    platformGameId: WOW_GAME,
    name: WOW_NAME,
    coverUrl: WOW_IMAGE,
    headerUrl: WOW_IMAGE,
  });
  if (game.schemaSyncedAt && Date.now() - game.schemaSyncedAt.getTime() < CATALOG_MAX_AGE) {
    return game;
  }
  const names = await fetchWowCatalog();
  await db.achievement.createMany({
    data: [...names].map(([id, name]) => ({
      gameId: game.id,
      platformAchievementId: String(id),
      name,
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT' as const,
      points: 0,
    })),
    skipDuplicates: true,
  });
  await db.game.update({
    where: { id: game.id },
    data: { totalAchievements: names.size, schemaSyncedAt: new Date() },
  });
  await refreshGameTier(game.id);
  return game;
}

async function fillWowDetail(achievement: { id: string; platformAchievementId: string }) {
  const id = achievement.platformAchievementId;
  const [detail, media] = await Promise.all([
    blizzardGet(`/data/wow/achievement/${id}`, STATIC).then((response) =>
      readJson<{ name: Texts; description?: Texts; points?: number }>(response),
    ),
    blizzardGet(`/data/wow/media/achievement/${id}`, STATIC).then((response) =>
      readJson<{ assets?: { key: string; value: string }[] }>(response),
    ),
  ]);
  const icon = media.assets?.find((asset) => asset.key === 'icon')?.value ?? null;
  const translations = Object.entries(LOCALES).map(([locale, code]) => ({
    achievementId: achievement.id,
    locale,
    name: detail.name[code] ?? '',
    description: detail.description?.[code] ?? '',
  }));
  await db.$transaction([
    db.achievement.update({
      where: { id: achievement.id },
      data: {
        name: detail.name[BASE_LOCALE],
        description: detail.description?.[BASE_LOCALE] ?? '',
        points: detail.points ?? 0,
        iconUrl: icon,
        iconLockedUrl: icon,
      },
    }),
    db.achievementTranslation.deleteMany({ where: { achievementId: achievement.id } }),
    db.achievementTranslation.createMany({
      data: translations.filter((row) => row.name),
      skipDuplicates: true,
    }),
  ]);
}

let filling: Promise<void> | null = null;

/** Un seul remplissage à la fois ; le balayage horaire reprend ce qui reste. */
export function fillWowCatalog() {
  return (filling ??= (async () => {
    const missing = await db.achievement.findMany({
      where: {
        iconUrl: null,
        game: { platform: 'BLIZZARD', platformGameId: WOW_GAME },
      },
      select: { id: true, platformAchievementId: true },
      take: DETAILS_PER_RUN,
    });
    await mapLimit(missing, DETAIL_CONCURRENCY, (achievement) =>
      fillWowDetail(achievement).catch((cause) =>
        log.error(`Succès WoW ${achievement.platformAchievementId} :`, cause),
      ),
    );
  })().finally(() => {
    filling = null;
  }));
}

/** Un personnage inactif répond 404 : il compte pour rien, sans faire échouer les autres. */
async function fetchCharacterUnlocks({ region, realm, name }: BlizzardCharacter) {
  const path = `/profile/wow/character/${realm}/${encodeURIComponent(name)}/achievements`;
  const response = await blizzardGet(path, { namespace: `profile-${region}` }, region);
  if (response.status === 404) return [];
  const { achievements = [] } = await readJson<{ achievements?: WowEarned[] }>(response);
  return wowUnlocks(achievements);
}

async function syncWow({ userId, account, onUnlocked }: SyncContext) {
  const characters = (account.characters ?? []) as unknown as BlizzardCharacter[];
  if (!characters.length) return 0;

  const game = await refreshWowCatalog();
  const lists: UnlockInput[][] = [];
  await syncGames(
    characters,
    { platform: WOW_NAME, concurrency: CONCURRENCY, name: (c) => c.name, report: () => {} },
    async (character) => void lists.push(await fetchCharacterUnlocks(character)),
  );
  const gained = await saveProgress(userId, game.id, mergeUnlocks(lists));
  if (gained > 0) onUnlocked(game, gained);
  void fillWowCatalog().catch((cause) => log.error('Catalogue WoW :', cause));
  return gained;
}

async function fetchSc2Catalog(locale: string) {
  const { achievements = [] } = await readJson<{ achievements?: Sc2Achievement[] }>(
    await blizzardGet(`/sc2/static/profile/${SC2_REGION}`, { locale }),
  );
  return achievements;
}

async function syncSc2({ userId, account, onUnlocked }: SyncContext) {
  const profiles = await readJson<{ regionId: number; realmId: number; profileId: string }[]>(
    await blizzardGet(`/sc2/player/${account.providerUserId}`),
  );
  if (!profiles.length) return 0;

  const game = await upsertGame({
    platform: 'BLIZZARD',
    platformGameId: SC2_GAME,
    name: SC2_NAME,
    coverUrl: SC2_IMAGE,
    headerUrl: SC2_IMAGE,
  });
  if (!game.schemaSyncedAt || Date.now() - game.schemaSyncedAt.getTime() >= CATALOG_MAX_AGE) {
    const [catalog, english] = await Promise.all([
      fetchSc2Catalog(BASE_LOCALE),
      fetchSc2Catalog('en_GB'),
    ]);
    const kept = new Set(english.filter(isRealSc2Achievement).map((a) => a.id));
    await db.achievement.deleteMany({
      where: { gameId: game.id, platformAchievementId: { notIn: [...kept] } },
    });
    await saveAchievements(game.id, catalog.filter((a) => kept.has(a.id)).map(mapSc2Achievement));
  }
  const lists = await Promise.all(
    profiles.map(async ({ regionId, realmId, profileId }) => {
      const response = await blizzardGet(`/sc2/profile/${regionId}/${realmId}/${profileId}`);
      if (response.status === 404) return [];
      const { earnedAchievements = [] } = await readJson<{ earnedAchievements?: Sc2Earned[] }>(
        response,
      );
      return sc2Unlocks(earnedAchievements);
    }),
  );
  const gained = await saveProgress(userId, game.id, mergeUnlocks(lists));
  if (gained > 0) onUnlocked(game, gained);
  return gained;
}

/** Les textes de WoW arrivent avec chaque succès : seul StarCraft II se traduit à la demande. */
export async function fetchBlizzardTexts(gameId: string, locale: Locale) {
  if (gameId !== SC2_GAME || locale === 'fr') return [] as AchievementText[];
  return (await fetchSc2Catalog(LOCALES[locale])).map((a): AchievementText => ({
    platformAchievementId: a.id,
    name: a.title,
    description: a.description ?? '',
  }));
}

const GAMES = [
  { name: WOW_NAME, sync: syncWow },
  { name: SC2_NAME, sync: syncSc2 },
];

export const syncBlizzard: ProviderSync = async (context) => {
  let achievements = 0;
  const games = await syncGames(
    GAMES,
    { platform: 'Battle.net', concurrency: 1, name: (g) => g.name, report: context.report },
    async ({ sync }) => {
      achievements += await sync(context);
    },
  );
  return { games, achievements };
};
