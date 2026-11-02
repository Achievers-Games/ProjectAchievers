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
}

/** Les étiquettes les plus votées de chaque jeu Steam, par numéro d'application. */
async function storeTags(appIds: number[]) {
  const input = {
    ids: appIds.map((appid) => ({ appid })),
    context: { language: 'english', country_code: 'US' },
    data_request: { include_tag_count: KEPT_TAGS },
  };
  const response = await fetchRetry(
    `${ITEMS}?input_json=${encodeURIComponent(JSON.stringify(input))}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { response?: { store_items?: StoreItem[] } };
  return new Map(
    (data.response?.store_items ?? []).map((item) => [
      item.appid,
      (item.tags ?? [])
        .toSorted((a, b) => b.weight - a.weight)
        .slice(0, KEPT_TAGS)
        .map((tag) => tag.tagid),
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

/**
 * Lit les genres des jeux qui n'en ont pas encore. Un jeu hors Steam prend ceux de sa version
 * Steam, connue ou retrouvée par son nom. Renvoie le nombre de jeux lus.
 */
export async function tagGames(limit = BATCH * 2, pause = PAUSE) {
  const games = await db.game.findMany({
    where: { tagsCheckedAt: null },
    select: { id: true, platform: true, platformGameId: true, name: true, familyKey: true },
    orderBy: { platform: 'asc' },
    take: limit,
  });
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

  let tagged = 0;
  for (let start = 0; start < games.length; start += TAG_BATCH) {
    const batch = games.slice(start, start + TAG_BATCH).filter((g) => !unanswered.has(g.id));
    const tags = await storeTags([...new Set(batch.flatMap((g) => steamIds.get(g.id) ?? []))]);
    // Limite atteinte : le lot suivant reprendra les jeux restants.
    if (!tags) break;
    await db.$transaction(
      batch.map((game) =>
        db.game.update({
          where: { id: game.id },
          data: { tags: tags.get(steamIds.get(game.id)) ?? [], tagsCheckedAt: new Date() },
        }),
      ),
    );
    tagged += batch.length;
    await sleep(pause);
  }
  return tagged;
}
