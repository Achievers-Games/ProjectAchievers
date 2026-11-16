import type { Prisma } from '#prisma';
import { db } from '../db';
import { familyKey } from '../family';
import { fetchRetry, sleep } from './errors';

const STORE = 'https://store.steampowered.com/api/appdetails';
/** La boutique tolère environ 200 requêtes par tranche de 5 minutes. */
const BATCH = 150;
const PAUSE = 1_500;

const FREQUENT_NUDITY = 4;
const ADULT_ONLY_SEXUAL_CONTENT = 3;

/** Seuls les jeux centrés sur le contenu sexuel sont masqués, pas ceux qui en comportent un peu. */
export const isAdultOnly = (descriptors: number[]) =>
  descriptors.includes(FREQUENT_NUDITY) || descriptors.includes(ADULT_ONLY_SEXUAL_CONTENT);

/** Lit la classification Steam des jeux qui n'en ont pas encore. Renvoie le nombre de jeux lus. */
export async function rateGames(limit = BATCH, pause = PAUSE) {
  const games = await db.game.findMany({
    where: { platform: 'STEAM', contentCheckedAt: null },
    select: { id: true, platformGameId: true },
    take: limit,
  });

  let rated = 0;
  for (const game of games) {
    const response = await fetchRetry(
      `${STORE}?appids=${game.platformGameId}&filters=content_descriptors`,
    );
    // Limite atteinte : le lot suivant reprendra les jeux restants.
    if (!response.ok) break;

    const data = (await response.json()) as Record<
      string,
      { data?: { content_descriptors?: { ids?: number[] } } } | undefined
    >;
    const descriptors = data[game.platformGameId]?.data?.content_descriptors?.ids ?? [];
    await db.game.update({
      where: { id: game.id },
      data: { adultOnly: isAdultOnly(descriptors), contentCheckedAt: new Date() },
    });
    rated += 1;
    await sleep(pause);
  }
  return rated;
}

const ITEMS = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const SEARCH = 'https://store.steampowered.com/api/storesearch/';
const TAG_BATCH = 50;
const KEPT_TAGS = 10;

interface StoreItem {
  appid?: number;
  tags?: { tagid: number; weight: number }[];
  screenshots?: { all_ages_screenshots?: { filename: string; ordinal?: number }[] };
  assets?: { asset_url_format?: string; raw_page_background?: string };
}

const STORE_ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/';

/**
 * L'image de fond d'un jeu, plein écran. D'abord le fond de sa page sur la boutique
 * (\`page_bg_raw\`, 1438 × 810) : une illustration composée pour passer derrière du texte. Sinon
 * la première capture, dans l'ordre choisi par l'éditeur, en 1920 × 1080 : nette, mais souvent
 * chargée de l'interface du jeu.
 */
export function storeArt(item: StoreItem) {
  const { asset_url_format: format, raw_page_background: raw } = item.assets ?? {};
  if (format && raw) return STORE_ASSETS + format.replace('${FILENAME}', raw);
  const [first] = (item.screenshots?.all_ages_screenshots ?? []).toSorted(
    (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0),
  );
  if (!first) return null;
  return STORE_ASSETS + first.filename.replace(/\.jpg(?=\?|$)/, '.1920x1080.jpg');
}

/** Les étiquettes et la capture de chaque jeu Steam, par numéro d'application. */
async function storeItems(appIds: number[]) {
  const input = {
    ids: appIds.map((appid) => ({ appid })),
    context: { language: 'english', country_code: 'US' },
    data_request: { include_tag_count: KEPT_TAGS, include_screenshots: true, include_assets: true },
  };
  const response = await fetchRetry(
    `${ITEMS}?input_json=${encodeURIComponent(JSON.stringify(input))}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { response?: { store_items?: StoreItem[] } };
  return new Map(
    (data.response?.store_items ?? []).map((item) => [
      item.appid,
      {
        tags: (item.tags ?? [])
          .toSorted((a, b) => b.weight - a.weight)
          .slice(0, KEPT_TAGS)
          .map((tag) => tag.tagid),
        art: storeArt(item),
      },
    ]),
  );
}

const ROMAN: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

/** « Assassin's Creed II » sur console, « Assassin's Creed 2 » sur Steam : le même épisode. */
export const episodeKey = (key: string | null) =>
  key
    ?.split(' ')
    .map((word) => ROMAN[word] ?? word)
    .join(' ') ?? null;

/** Le même jeu sur Steam, retrouvé par son nom. `undefined` : la boutique n'a pas répondu. */
async function steamTwin(name: string, key: string | null) {
  const response = await fetchRetry(`${SEARCH}?term=${encodeURIComponent(name)}&cc=US&l=english`);
  if (!response.ok) return undefined;
  const data = (await response.json()) as { items?: { id: number; name: string }[] };
  const wanted = episodeKey(key);
  return data.items?.find((item) => episodeKey(familyKey(item.name)) === wanted)?.id ?? null;
}

type StoreGame = {
  id: string;
  platform: string;
  platformGameId: string;
  name: string;
  familyKey: string | null;
};

/**
 * Lit sur la boutique Steam ce qui manque aux jeux donnés. Un jeu hors Steam passe par sa
 * version Steam, connue ou retrouvée par son nom. Renvoie le nombre de jeux lus.
 */
async function readStore(
  games: StoreGame[],
  pause: number,
  write: (item: { tags: number[]; art: string | null } | undefined) => Prisma.GameUpdateInput,
) {
  const steamIds = new Map<string, number>();
  const unanswered = new Set<string>();
  for (const game of games) {
    if (game.platform === 'STEAM') {
      const appId = Number(game.platformGameId);
      if (Number.isInteger(appId)) steamIds.set(game.id, appId);
      continue;
    }
    const sibling = game.familyKey
      ? await db.game.findFirst({
          where: { platform: 'STEAM', familyKey: game.familyKey },
          select: { platformGameId: true },
        })
      : null;
    const appId = sibling
      ? Number(sibling.platformGameId)
      : await steamTwin(game.name, game.familyKey);
    if (!sibling) await sleep(pause);
    if (appId === undefined) unanswered.add(game.id);
    else if (appId && Number.isInteger(appId)) steamIds.set(game.id, appId);
  }

  let read = 0;
  for (let start = 0; start < games.length; start += TAG_BATCH) {
    const batch = games.slice(start, start + TAG_BATCH).filter((g) => !unanswered.has(g.id));
    const items = await storeItems([...new Set(batch.flatMap((g) => steamIds.get(g.id) ?? []))]);
    // Limite atteinte : le lot suivant reprendra les jeux restants.
    if (!items) break;
    await db.$transaction(
      batch.map((game) =>
        db.game.update({ where: { id: game.id }, data: write(items.get(steamIds.get(game.id))) }),
      ),
    );
    read += batch.length;
    await sleep(pause);
  }
  return read;
}

const storeGame = {
  id: true,
  platform: true,
  platformGameId: true,
  name: true,
  familyKey: true,
} as const;

/** Lit les genres (et la capture) des jeux qui n'en ont pas encore. */
export async function tagGames(limit = BATCH * 2, pause = PAUSE) {
  const games = await db.game.findMany({
    where: { tagsCheckedAt: null },
    select: storeGame,
    orderBy: { platform: 'asc' },
    take: limit,
  });
  const now = new Date();
  return readStore(games, pause, (item) => ({
    tags: item?.tags ?? [],
    tagsCheckedAt: now,
    artUrl: item?.art ?? null,
    artCheckedAt: now,
  }));
}

const writeArt = (now: Date) => (item: { art: string | null } | undefined) => ({
  artUrl: item?.art ?? null,
  artCheckedAt: now,
});

/**
 * La capture des jeux déjà classés avant qu'on la lise : une seule fois par jeu. Les jeux Steam
 * passent à part (`steam`) : cinquante par appel, sans recherche, ils ne doivent pas attendre
 * derrière les jeux de console, qu'il faut d'abord retrouver sur Steam un par un.
 */
export async function artGames(limit = BATCH * 2, pause = PAUSE, only?: 'steam' | 'consoles') {
  const platform =
    only === 'steam' ? 'STEAM' : only === 'consoles' ? { not: 'STEAM' as const } : undefined;
  const games = await db.game.findMany({
    where: { artCheckedAt: null, ...(platform && { platform }) },
    select: storeGame,
    orderBy: { platform: 'asc' },
    take: limit,
  });
  return readStore(games, pause, writeArt(new Date()));
}

/**
 * La capture d'un jeu, tout de suite : choisi en fond, ou ouvert avant que la tâche de fond ne
 * l'atteigne. Rien si elle a déjà été lue.
 */
export async function artNow(gameIds: string[], slugs: string[] = []) {
  const games = await db.game.findMany({
    where: { artCheckedAt: null, OR: [{ id: { in: gameIds } }, { slug: { in: slugs } }] },
    select: storeGame,
  });
  if (!games.length) return 0;
  return readStore(games, 0, writeArt(new Date()));
}
