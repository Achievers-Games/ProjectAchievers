/**
 * Les boosters de cartes : prix, taux et tirage. Chaque carte d'un booster est une édition
 * visuelle d'un jeu de la bibliothèque du joueur. Valeurs de départ, à calibrer.
 */
import type { BoosterKind, EditionKind } from '#prisma';

/** Prix d'un booster acheté, en éclats. */
export const BOOSTER_PRICE = 25;
export const CARDS_PER_BOOSTER = 5;
/** Boosters offerts qui peuvent s'accumuler : une semaine d'absence ne fait rien perdre. */
export const DAILY_MAX = 7;
/** Chaque 10e booster normal est doré. */
export const GOLDEN_EVERY = 10;
/** Au bout de ce nombre de boosters sans Mythique, la dernière carte en est une. */
export const MYTHIQUE_PITY = 250;
/** Le fuseau du jour du booster offert : minuit à Paris pour tout le monde. */
export const DAILY_TIME_ZONE = 'Europe/Paris';

export const EDITIONS = ['RELIEF', 'VIVANTE', 'MYTHIQUE'] as const satisfies EditionKind[];

/** Chances par carte. Le reste est du Relief. */
export const RATES: Record<BoosterKind, { VIVANTE: number; MYTHIQUE: number }> = {
  NORMAL: { VIVANTE: 0.0125, MYTHIQUE: 0.0005 },
  GOLDEN: { VIVANTE: 0.0125, MYTHIQUE: 0.0005 },
  STARRED: { VIVANTE: 0.075, MYTHIQUE: 0.005 },
  CELESTIAL: { VIVANTE: 0.14, MYTHIQUE: 0.01 },
};

/** Cartes au moins Vivantes garanties dans un booster. */
export const GUARANTEED: Record<BoosterKind, number> = {
  NORMAL: 0,
  GOLDEN: 1,
  STARRED: 1,
  CELESTIAL: 2,
};

/** Ce que rend une édition déjà possédée. */
export const DUPLICATE_SHARDS: Record<EditionKind, number> = {
  RELIEF: 1,
  VIVANTE: 8,
  MYTHIQUE: 40,
};

export interface PoolEntry {
  editionId: string;
  familyKey: string;
}
export type Pool = Record<EditionKind, PoolEntry[]>;

export interface DrawnCard {
  editionId: string;
  familyKey: string;
  kind: EditionKind;
}

const rank = (kind: EditionKind) => EDITIONS.indexOf(kind);

/** Un booster ouvert après `opened` boosters normaux : doré tous les `GOLDEN_EVERY`. */
export const normalKind = (opened: number): BoosterKind =>
  (opened + 1) % GOLDEN_EVERY === 0 ? 'GOLDEN' : 'NORMAL';

/** Le pool contient-il au moins une édition ? Sans rien, un booster ne peut pas s'ouvrir. */
export const canDraw = (pool: Pool) => EDITIONS.some((kind) => pool[kind].length > 0);

/** Une rareté tirée sans édition à donner descend d'un cran ; tout en bas, elle remonte. */
function available(pool: Pool, wanted: EditionKind): EditionKind {
  for (let i = rank(wanted); i >= 0; i--) if (pool[EDITIONS[i]!].length) return EDITIONS[i]!;
  for (let i = rank(wanted) + 1; i < EDITIONS.length; i++)
    if (pool[EDITIONS[i]!].length) return EDITIONS[i]!;
  throw new Error('Pool vide');
}

/** Une carte de la rareté tirée, à chances égales : aucun jeu n'est favorisé. */
const pick = (entries: PoolEntry[], random: () => number) =>
  entries[Math.min(Math.floor(random() * entries.length), entries.length - 1)]!;

/**
 * Tire un booster. `random` rend un nombre dans [0, 1[ : le serveur passe un tirage
 * cryptographique, les tests une suite fixe. Renvoie les cartes et le compteur de garantie
 * suivant : il repart à zéro après une Mythique, et ne bouge pas tant qu'aucune Mythique
 * n'existe au catalogue. Le tirage est un pur hasard : la rareté suit `RATES`, puis la carte est
 * prise au hasard parmi toutes celles de cette rareté. Une même carte peut sortir deux fois dans
 * un booster : le doublon part au recyclage.
 */
export function drawBooster(
  kind: BoosterKind,
  pool: Pool,
  pityMythique: number,
  random: () => number,
): { cards: DrawnCard[]; pityMythique: number } {
  if (!canDraw(pool)) throw new Error('Pool vide');
  const rates = RATES[kind];
  const wanted: EditionKind[] = Array.from({ length: CARDS_PER_BOOSTER }, () => {
    const roll = random();
    if (roll < rates.MYTHIQUE) return 'MYTHIQUE';
    return roll < rates.MYTHIQUE + rates.VIVANTE ? 'VIVANTE' : 'RELIEF';
  });

  // Les garanties montent les dernières cartes : la révélation garde le meilleur pour la fin.
  let rare = wanted.filter((rarity) => rarity !== 'RELIEF').length;
  for (let i = CARDS_PER_BOOSTER - 1; i >= 0 && rare < GUARANTEED[kind]; i--) {
    if (wanted[i] === 'RELIEF') {
      wanted[i] = 'VIVANTE';
      rare++;
    }
  }
  const mythiquePossible = pool.MYTHIQUE.length > 0;
  if (mythiquePossible && pityMythique + 1 >= MYTHIQUE_PITY && !wanted.includes('MYTHIQUE')) {
    wanted[CARDS_PER_BOOSTER - 1] = 'MYTHIQUE';
  }

  const cards = wanted.map((rarity) => {
    const kindGiven = available(pool, rarity);
    const entry = pick(pool[kindGiven], random);
    return { editionId: entry.editionId, familyKey: entry.familyKey, kind: kindGiven };
  });
  const gotMythique = cards.some((card) => card.kind === 'MYTHIQUE');
  return {
    cards,
    pityMythique: gotMythique ? 0 : mythiquePossible ? pityMythique + 1 : pityMythique,
  };
}

/** Le jour calendaire à Paris, en jours depuis l'époque : minuit à Paris change de jour. */
export function parisDay(date: Date) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number);
  return Math.round(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

/** Les boosters offerts disponibles maintenant : un de plus par jour écoulé, jusqu'à 7. */
export const dailyStock = (stock: number, since: Date, now = new Date()) =>
  Math.min(DAILY_MAX, stock + Math.max(parisDay(now) - parisDay(since), 0));
