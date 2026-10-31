import { db } from '../db';
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
