interface GenreDef {
  tags: readonly number[];
  steps: readonly number[];
}

/**
 * Les genres, d'après les étiquettes Steam (numéros de `IStoreService/GetTagList`) : un jeu en fait
 * partie si l'une d'elles figure parmi ses plus votées. Chaque palier est un succès `g_<genre>_<n>`.
 */
export const GENRES = {
  horror: { tags: [1667, 1721, 3978, 42089], steps: [1, 5, 15, 30, 50, 100] },
  roguelike: { tags: [1716, 3959, 42804, 454187, 1091588], steps: [1, 3, 5, 10, 15, 30] },
  platformer: { tags: [1625, 5379, 5395, 3877], steps: [1, 5, 15, 30, 50, 100] },
  puzzle: { tags: [1664, 6129, 5537], steps: [1, 5, 15, 30, 50, 100] },
  rpg: { tags: [122, 4231, 4474, 10695, 21725], steps: [1, 5, 15, 30, 50, 100] },
  shooter: { tags: [1663, 1774, 3814], steps: [1, 5, 15, 30, 50, 100] },
  racing: { tags: [699], steps: [1, 3, 5, 10, 15, 30] },
  sports: { tags: [701], steps: [1, 3, 5, 10, 15, 30] },
  strategy: { tags: [9, 1676, 1741], steps: [1, 3, 5, 10, 15, 30] },
  simulation: { tags: [599], steps: [1, 5, 15, 30, 50, 100] },
  survival: { tags: [1662, 1100689], steps: [1, 3, 5, 10, 15, 30] },
  cozy: { tags: [1654, 97376, 552282], steps: [1, 3, 5, 10, 15, 30] },
  cute: { tags: [4726], steps: [1, 3, 5, 10, 15, 30] },
  open_world: { tags: [1695], steps: [1, 5, 15, 30, 50, 100] },
  short: { tags: [4234], steps: [1, 3, 5, 10, 15, 30] },
  pixel: { tags: [3964], steps: [1, 3, 5, 10, 15, 30] },
  anime: { tags: [4085], steps: [1, 3, 5, 10, 15, 30] },
  deck: { tags: [1666, 32322, 791774], steps: [1, 3, 5, 10, 15, 30] },
  point_click: { tags: [1698], steps: [1, 3, 5, 10, 15, 30] },
  stealth: { tags: [1687], steps: [1, 3, 5, 10, 15, 30] },
  fighting: { tags: [1743, 4736], steps: [1, 3, 5, 10, 15, 30] },
  rhythm: { tags: [1752], steps: [1, 3, 5, 10, 15, 30] },
  visual_novel: { tags: [3799], steps: [1, 3, 5, 10, 15, 30] },
  shmup: { tags: [4255, 4885, 723991], steps: [1, 3, 5, 10, 15, 30] },
  zombies: { tags: [1659], steps: [1, 3, 5, 10, 15, 30] },
  difficult: { tags: [4026, 1733], steps: [1, 3, 5, 10, 15, 30] },
  soulslike: { tags: [29482], steps: [1, 2, 3, 5, 10, 20] },
  metroidvania: { tags: [1628], steps: [1, 2, 3, 5, 10, 20] },
  jrpg: { tags: [4434], steps: [1, 2, 3, 5, 10, 20] },
  story_rich: { tags: [1742], steps: [1, 5, 15, 30, 50, 100] },
  choices: { tags: [6426, 6971], steps: [1, 3, 5, 10, 15, 30] },
  arcade: { tags: [1773], steps: [1, 3, 5, 10, 15, 30] },
  retro: { tags: [4004], steps: [1, 3, 5, 10, 15, 30] },
  comedy: { tags: [1719, 4136, 5923], steps: [1, 3, 5, 10, 15, 30] },
  sci_fi: { tags: [3942], steps: [1, 5, 15, 30, 50, 100] },
  fantasy: { tags: [1684, 4604], steps: [1, 5, 15, 30, 50, 100] },
  exploration: { tags: [3834], steps: [1, 5, 15, 30, 50, 100] },
  atmospheric: { tags: [4166], steps: [1, 5, 15, 30, 50, 100] },
  psychological: { tags: [5186, 1710], steps: [1, 3, 5, 10, 15, 30] },
  sandbox: { tags: [3810, 1702], steps: [1, 3, 5, 10, 15, 30] },
  city_builder: { tags: [4328, 220585, 7332], steps: [1, 2, 3, 5, 10, 20] },
  tower_defense: { tags: [1645], steps: [1, 2, 3, 5, 10, 20] },
  hack_slash: { tags: [1646, 4777, 3955], steps: [1, 2, 3, 5, 10, 20] },
  beat_em_up: { tags: [4158], steps: [1, 2, 3, 5, 10, 20] },
  tactics: { tags: [14139], steps: [1, 2, 3, 5, 10, 20] },
  walking_sim: { tags: [5900], steps: [1, 2, 3, 5, 10, 20] },
  mystery: { tags: [5716, 6052], steps: [1, 2, 3, 5, 10, 20] },
  post_apo: { tags: [3835], steps: [1, 2, 3, 5, 10, 20] },
  management: { tags: [12472], steps: [1, 2, 3, 5, 10, 20] },
  casual_puzzle: { tags: [1738, 1665], steps: [1, 2, 3, 5, 10, 20] },
  idle: { tags: [615955, 379975], steps: [1, 2, 3, 5, 10, 20] },
  dungeon_crawler: { tags: [1720, 198631], steps: [1, 2, 3, 5, 10, 20] },
  military: { tags: [4168, 4150, 13276], steps: [1, 2, 3, 5, 10, 20] },
} as const satisfies Record<string, GenreDef>;

/** Les thèmes : un seul jeu suffit, pour le clin d'œil. */
export const THEMES = {
  cats: { tags: [17894], steps: [1] },
  dinosaurs: { tags: [5160], steps: [1] },
  pirates: { tags: [1681], steps: [1] },
  space: { tags: [1755, 4291, 16598], steps: [1] },
  vampires: { tags: [12686], steps: [1] },
  ninja: { tags: [1688], steps: [1] },
  lovecraft: { tags: [7432], steps: [1] },
  robots: { tags: [5752, 4821], steps: [1] },
  dragons: { tags: [4046], steps: [1] },
  cooking: { tags: [3920], steps: [1] },
  fishing: { tags: [15564], steps: [1] },
  farming: { tags: [22602, 87918, 4520], steps: [1] },
  western: { tags: [1647], steps: [1] },
  time_travel: { tags: [10679, 6625], steps: [1] },
  detective: { tags: [5613, 8369], steps: [1] },
  cyberpunk: { tags: [4115], steps: [1] },
  steampunk: { tags: [1777], steps: [1] },
  mythology: { tags: [16094], steps: [1] },
  aliens: { tags: [1673], steps: [1] },
  superhero: { tags: [1671], steps: [1] },
  magic: { tags: [4057], steps: [1] },
  demons: { tags: [9541], steps: [1] },
  werewolves: { tags: [17015], steps: [1] },
  gothic: { tags: [3952], steps: [1] },
  samurai: { tags: [10617], steps: [1] },
  vikings: { tags: [11634], steps: [1] },
  dogs: { tags: [1638], steps: [1] },
  horses: { tags: [6041], steps: [1] },
  underwater: { tags: [9157], steps: [1] },
  snow: { tags: [9803], steps: [1] },
  mars: { tags: [6702], steps: [1] },
  trains: { tags: [1616], steps: [1] },
  flight: { tags: [15045, 92092], steps: [1] },
  naval: { tags: [6910, 19780], steps: [1] },
  heist: { tags: [1680, 6378], steps: [1] },
  // Steam a deux étiquettes : « Assassin » et « Assassins », celle des Assassin's Creed.
  assassin: { tags: [4376, 97070], steps: [1] },
  martial_arts: { tags: [6915, 12190, 47827], steps: [1] },
  football: { tags: [1254546, 1254552, 49213], steps: [1] },
  golf: { tags: [7038, 22955], steps: [1] },
  skate: { tags: [1753, 28444], steps: [1] },
  hunting: { tags: [9564], steps: [1] },
  pinball: { tags: [6621], steps: [1] },
  board_games: { tags: [4184, 1770], steps: [1] },
  words: { tags: [24003, 10437, 1674], steps: [1] },
  music: { tags: [1621], steps: [1] },
} as const satisfies Record<string, GenreDef>;

type StepCodes<T> = {
  [K in keyof T]: T[K] extends { steps: readonly (infer N extends number)[] }
    ? `g_${K & string}_${N}`
    : never;
}[keyof T];
export type GenreKey = keyof typeof GENRES | keyof typeof THEMES;
type GenreCode = StepCodes<typeof GENRES> | StepCodes<typeof THEMES>;

const ALL_GENRES: Record<string, GenreDef> = { ...GENRES, ...THEMES };

/** Les succès entre amis, à paliers : `<série>_<n>` se gagne quand le compte atteint `n`. */
export const FRIEND_SERIES = {
  duo: [1, 3, 5, 10, 15, 30],
  revenge: [1, 3, 5, 10, 15, 30],
  teammates: [1, 2, 3, 5, 10, 20],
  synchro: [1, 5, 10, 50, 100, 250],
  prescriber: [1, 3, 5, 10, 15, 30],
  same_taste: [10, 50, 100, 250, 500, 1000],
} as const;

/** Les succès de clan : le clan les gagne, ses membres du moment les reçoivent. */
export const CLAN_SERIES = {
  guild: [1000, 2500, 5000, 10000, 50000, 100000],
  clan_collection: [10, 25, 50, 100, 250, 500],
  clan_range: [5, 10, 20, 30, 45, 50],
  raid: [2, 3, 5, 10, 15, 25],
  clan_night: [1, 5, 10, 25, 50, 100],
  all_in: [1, 2, 4, 8, 12, 26],
  marathon: [3, 7, 14, 30, 100, 365],
  together_season: [5, 10, 25, 50, 100, 150],
  band: [3, 5, 10, 15, 25, 50],
} as const;

type SeriesCodes<T> = {
  [K in keyof T]: T[K] extends readonly (infer N extends number)[] ? `${K & string}_${N}` : never;
}[keyof T];
export type FriendKey = keyof typeof FRIEND_SERIES;
export type ClanKey = keyof typeof CLAN_SERIES;
export type SeriesKey = FriendKey | ClanKey;
type FriendCode = SeriesCodes<typeof FRIEND_SERIES>;
type ClanSeriesCode = SeriesCodes<typeof CLAN_SERIES>;

const ALL_SERIES: Record<string, readonly number[]> = { ...FRIEND_SERIES, ...CLAN_SERIES };

const seriesCodes = <T extends Record<string, readonly number[]>>(list: T) =>
  Object.entries(list).flatMap(([key, steps]) =>
    steps.map((step) => `${key}_${step}`),
  ) as SeriesCodes<T>[];

/** La série et le palier d'un succès d'amis ou de clan ; `level` va de 1 à 3. */
export function seriesOf(code: string) {
  const match = /^([a-z_]+)_(\d+)$/.exec(code);
  const steps = match && ALL_SERIES[match[1]!];
  if (!match || !steps) return null;
  const count = Number(match[2]);
  const level = steps.indexOf(count) + 1;
  return level ? { key: match[1] as SeriesKey, count, level } : null;
}

const stepCodes = <T extends Record<string, GenreDef>>(list: T) =>
  Object.entries(list).flatMap(([key, { steps }]) =>
    steps.map((step) => `g_${key}_${step}`),
  ) as StepCodes<T>[];

/** Le genre et le palier d'un succès de genre ; `level` va de 1 à 3. */
export function genreOf(code: string) {
  const match = /^g_(\w+)_(\d+)$/.exec(code);
  const def = match && ALL_GENRES[match[1]!];
  if (!match || !def) return null;
  const count = Number(match[2]);
  return { key: match[1] as GenreKey, count, level: def.steps.indexOf(count) + 1, tags: def.tags };
}

/** Les succès du site, par catégorie, plus ceux des événements. Les textes sont les messages `ach_<code>_title` et `_text`. */
export const WITHDRAWAL_DAYS = {
  withdrawal_7: 7,
  withdrawal_14: 14,
  withdrawal: 30,
  withdrawal_90: 90,
  withdrawal_180: 180,
  withdrawal_365: 365,
} as const;

const WITHDRAWAL_STEPS = Object.keys(WITHDRAWAL_DAYS) as (keyof typeof WITHDRAWAL_DAYS)[];
const ONE_LEFT_STEPS = ['one_left', 'one_left_30', 'one_left_90'] as const;
const YET_ANOTHER_STEPS = ['yet_another', 'yet_another_10', 'yet_another_20'] as const;

const CHALLENGE_TEXT = new Map<string, { key: string; count: number }>([
  ...WITHDRAWAL_STEPS.map(
    (code) => [code, { key: 'withdrawal', count: WITHDRAWAL_DAYS[code] }] as const,
  ),
  ...ONE_LEFT_STEPS.map(
    (code, index) => [code, { key: 'one_left', count: [7, 30, 90][index]! }] as const,
  ),
  ...YET_ANOTHER_STEPS.map(
    (code, index) => [code, { key: 'yet_another', count: [5, 10, 20][index]! }] as const,
  ),
]);
export const challengeText = (code: string) => CHALLENGE_TEXT.get(code);

const BASE_CATEGORIES = {
  start: [
    'first_account',
    'two_platforms',
    'three_platforms',
    'makeover',
    'storefront',
    'ring_me',
    'stage_name',
    'painful_compare',
  ],
  cards: [
    'cards_1',
    'cards_10',
    'cards_25',
    'cards_50',
    'cards_100',
    'cards_250',
    'gold_1',
    'gold_5',
    'gold_10',
    'gold_25',
    'gold_100',
    'gold_250',
    'diamond_1',
    'diamond_3',
    'diamond_5',
    'diamond_10',
    'diamond_50',
    'diamond_100',
    'prismatic_1',
    'prismatic_3',
    'prismatic_5',
    'prismatic_10',
    'prismatic_25',
    'prismatic_50',
    'bronze_25',
    'copies2_1',
    'copies2_2',
    'copies2_3',
    'copies2_5',
    'copies2_10',
    'copies2_25',
    'wide_gap',
    'reverse_gear',
    'shiny_double',
    'second_helping',
    'legendary',
    'legendary_2',
    'legendary_3',
    'legendary_5',
    'legendary_10',
    'legendary_25',
    'game_50',
    'game_100',
    'game_150',
    'game_250',
    'game_500',
    'game_1000',
    'small_10',
    'borderless',
  ],
  volume: [
    'unlocks_100',
    'unlocks_1000',
    'unlocks_5000',
    'unlocks_10000',
    'unlocks_20000',
    'unlocks_50000',
  ],
  rarity: [
    'rare_1',
    'rare_10',
    'rare_50',
    'rare_100',
    'rare_250',
    'rare_500',
    'ultra_rare',
    'ultra_rare_3',
    'ultra_rare_5',
    'ultra_rare_10',
    'ultra_rare_25',
    'ultra_rare_50',
    'podium',
  ],
  time: [
    'hours_100',
    'hours_500',
    'hours_1000',
    'hours_2500',
    'hours_12500',
    'hours_25000',
    'playtime_1000',
    'playtime_5000',
    'playtime_10000',
    'playtime_25000',
    'playtime_75000',
    'playtime_100000',
    'quick_1',
    'quick_3',
    'quick_5',
    'quick_10',
    'quick_15',
    'quick_30',
    'library_100',
    'library_250',
    'library_500',
    'library_1000',
    'library_2000',
    'library_5000',
  ],
  habits: [
    'stalled_3',
    'stalled_5',
    'stalled_10',
    'stalled_25',
    'stalled_50',
    'stalled_100',
    'almost',
    'unfinished_50',
    'unfinished_100',
    'unfinished_250',
    'unfinished_500',
    'unfinished_1500',
    'unfinished_3000',
    'barely_played_50',
    'sealed_100',
    'resurrection',
    ...ONE_LEFT_STEPS,
    'one_more_10',
    'one_more_50',
    'one_more_100',
    'one_more_250',
    'one_more_1000',
    'one_more_2500',
    ...YET_ANOTHER_STEPS,
    ...WITHDRAWAL_STEPS,
    'streak_7',
    'streak_100',
    'late_5',
    'late_10',
    'double_finish',
    'weekend_100',
    'no_safety_net',
  ],
  social: [
    'friend_1',
    'friends_3',
    'friends_5',
    'friends_10',
    'friends_25',
    'friends_50',
    'clan_join',
    'clan_5',
    'messages_10',
    'messages_25',
    'messages_50',
    'messages_100',
    'messages_250',
    'messages_500',
    'comment_1',
    'comments_5',
    'comments_10',
    'comments_25',
    'comments_50',
    'comments_100',
    'reactions_1',
    'reactions_5',
    'reactions_10',
    'reactions_25',
    'reactions_50',
    'reactions_100',
    'guide_done',
    'guide_score_10',
    'snitch',
    'support',
  ],
  season: ['season_tier2', 'season_tier3', 'season_finish_1', 'season_finish_3', 'season_goal'],
  /** Des succès faciles, propres à un événement : ils s'ajoutent aux 100 sans compter dedans. */
  event: ['founder'],
  secret: [
    'midnight',
    'friday13',
    'birthday',
    'christmas',
    'new_year',
    'night_owl',
    'monk',
    'world_tour',
    'hare',
    'alphabet',
    'rarest_last',
    'nights_1001',
    'forty_two',
    'soulmates',
    'twins',
    'perfect_clan',
    'grand_slam',
    'full_set',
    'four_of_a_kind',
    'straight',
    'legend_double',
    'six_months',
    'last_word',
    'deserter',
    'mood_swing',
    'dark_hours',
    'comfort_zone',
    'bad_influence',
    'insomniacs',
    'ghost_clan',
  ],
} as const;

/** Les succès de clan sans palier. */
const CLAN_SINGLES = ['nobody_behind', 'loyal'] as const;

const GENRE_TOURS = [
  'genre_tour_5',
  'genre_tour_10',
  'genre_tour_20',
  'genre_tour_30',
  'genre_tour_40',
  'genre_tour_50',
] as const;

const { secret, ...visible } = BASE_CATEGORIES;

/** Les secrets ferment la marche. */
export const SITE_CATEGORIES = {
  ...visible,
  friends: seriesCodes(FRIEND_SERIES),
  clan: [...seriesCodes(CLAN_SERIES), ...CLAN_SINGLES],
  genres: [...stepCodes(GENRES), ...GENRE_TOURS],
  themes: stepCodes(THEMES),
  secret,
};

/** Les succès à une règle propre ; ceux des genres se lisent avec `genreOf`. */
export type BaseCode =
  | (typeof BASE_CATEGORIES)[keyof typeof BASE_CATEGORIES][number]
  | (typeof GENRE_TOURS)[number]
  | (typeof CLAN_SINGLES)[number];
export type SiteCode = BaseCode | GenreCode | FriendCode | ClanSeriesCode;
/** Gagnés par le clan entier, jamais par un joueur seul : voir `checkClanAchievements`. */
export type ClanCode = ClanSeriesCode | (typeof CLAN_SINGLES)[number] | 'insomniacs' | 'ghost_clan';
export const CLAN_CODES = new Set<string>([...SITE_CATEGORIES.clan, 'insomniacs', 'ghost_clan']);

export const SITE_CODES = Object.values(SITE_CATEGORIES).flat() as SiteCode[];
export const EVENT_CODES = new Set<string>(SITE_CATEGORIES.event);
export const SECRET_CODES = new Set<string>(SITE_CATEGORIES.secret);
/** Les succès permanents, ceux du compteur : les événements s'y ajoutent sans compter. */
export const SITE_TOTAL = SITE_CODES.filter((code) => !EVENT_CODES.has(code)).length;

/** Les succès à paliers hors genres : une seule carte, qui montre le palier suivant. */
const BASE_SERIES: readonly (readonly SiteCode[])[] = [
  ['cards_1', 'cards_10', 'cards_25', 'cards_50', 'cards_100', 'cards_250'],
  ['gold_1', 'gold_5', 'gold_10', 'gold_25', 'gold_100', 'gold_250'],
  ['diamond_1', 'diamond_3', 'diamond_5', 'diamond_10', 'diamond_50', 'diamond_100'],
  ['prismatic_1', 'prismatic_3', 'prismatic_5', 'prismatic_10', 'prismatic_25', 'prismatic_50'],
  ['legendary', 'legendary_2', 'legendary_3', 'legendary_5', 'legendary_10', 'legendary_25'],
  ['copies2_1', 'copies2_2', 'copies2_3', 'copies2_5', 'copies2_10', 'copies2_25'],
  ['game_50', 'game_100', 'game_150', 'game_250', 'game_500', 'game_1000'],
  [
    'unlocks_100',
    'unlocks_1000',
    'unlocks_5000',
    'unlocks_10000',
    'unlocks_20000',
    'unlocks_50000',
  ],
  ['rare_1', 'rare_10', 'rare_50', 'rare_100', 'rare_250', 'rare_500'],
  ['ultra_rare', 'ultra_rare_3', 'ultra_rare_5', 'ultra_rare_10', 'ultra_rare_25', 'ultra_rare_50'],
  ['hours_100', 'hours_500', 'hours_1000', 'hours_2500', 'hours_12500', 'hours_25000'],
  [
    'playtime_1000',
    'playtime_5000',
    'playtime_10000',
    'playtime_25000',
    'playtime_75000',
    'playtime_100000',
  ],
  ['quick_1', 'quick_3', 'quick_5', 'quick_10', 'quick_15', 'quick_30'],
  ['library_100', 'library_250', 'library_500', 'library_1000', 'library_2000', 'library_5000'],
  ['stalled_3', 'stalled_5', 'stalled_10', 'stalled_25', 'stalled_50', 'stalled_100'],
  [
    'unfinished_50',
    'unfinished_100',
    'unfinished_250',
    'unfinished_500',
    'unfinished_1500',
    'unfinished_3000',
  ],
  ['one_more_10', 'one_more_50', 'one_more_100', 'one_more_250', 'one_more_1000', 'one_more_2500'],
  ['friend_1', 'friends_3', 'friends_5', 'friends_10', 'friends_25', 'friends_50'],
  ['messages_10', 'messages_25', 'messages_50', 'messages_100', 'messages_250', 'messages_500'],
  ['comment_1', 'comments_5', 'comments_10', 'comments_25', 'comments_50', 'comments_100'],
  ['reactions_1', 'reactions_5', 'reactions_10', 'reactions_25', 'reactions_50', 'reactions_100'],
  ['two_platforms', 'three_platforms'],
  ['streak_7', 'streak_100'],
  ONE_LEFT_STEPS,
  YET_ANOTHER_STEPS,
  WITHDRAWAL_STEPS,
  ['late_5', 'late_10'],
  ['clan_join', 'clan_5'],
  ['season_tier2', 'season_tier3'],
  ['season_finish_1', 'season_finish_3'],
  GENRE_TOURS,
];
const SERIES_OF = new Map(
  BASE_SERIES.flatMap((codes, index) => codes.map((code) => [code as string, `s${index}`])),
);

/** Réunit les paliers d'un même succès, dans l'ordre de la liste : `[[cards_1, cards_10…], [makeover]…]`. */
export function groupSeries<T extends string>(codes: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const code of codes) {
    const genre = genreOf(code);
    const series = seriesOf(code);
    const key = genre
      ? `g_${genre.key}`
      : series
        ? `s_${series.key}`
        : (SERIES_OF.get(code) ?? code);
    groups.set(key, [...(groups.get(key) ?? []), code]);
  }
  return [...groups.values()];
}

/**
 * Le niveau de carte d'un palier, comme les cartes de jeux : Bronze, Argent, Or, Diamant,
 * Prismatique, puis Légendaire. Au-delà de six paliers, ils se répartissent jusqu'au dernier.
 */
export const stepTier = (index: number, steps: number) =>
  steps <= 1 ? 0 : steps <= 6 ? index + 1 : 1 + Math.round((index * 5) / (steps - 1));

/** Le niveau de chaque succès, calculé une fois : Bronze pour les succès à un seul palier. */
const TIER_OF = new Map(
  groupSeries(SITE_CODES).flatMap((steps) =>
    steps.map((code, index) => [code, stepTier(index, steps.length) || 1] as const),
  ),
);
export const tierOf = (code: string) => TIER_OF.get(code as SiteCode) ?? 0;
