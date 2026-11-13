import type { Platform } from '#prisma';
import {
  FRIEND_SERIES,
  GENRES,
  SITE_CATEGORIES,
  genreOf,
  seriesOf,
  type BaseCode,
  type ClanCode,
  type FriendKey,
  type SiteCode,
} from '#lib/site-achievements';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;
const MAX_PROOF = 6;

export interface GameFact {
  gameId: string;
  name: string;
  platform: Platform;
  unlocked: number;
  total: number;
  completion: number;
  playtime: number;
  played: boolean;
  /** Date du dernier succès, donc de la fin du jeu à 100 %. */
  lastAt: number | null;
  /** Étiquettes Steam du jeu, ou de sa version Steam. */
  tags: number[];
}

export interface UnlockFact {
  at: number;
  gameId: string;
  achievementId: string;
  platform: Platform;
  rarity: number | null;
  /** Rafale : un outil ou une synchronisation plutôt qu'une partie. */
  burst?: boolean;
}

interface CardFact {
  gameId: string;
  tier: number;
  copies: number;
  lastAt: number | null;
  /** Une autre version du jeu est commencée. */
  next: boolean;
}

export interface SeasonFacts {
  startsAt: number;
  endsAt: number;
  tiers: readonly [number, number, number];
  points: number;
  /** Place parmi les profils publics, à partir de 1. */
  rank: number | null;
  ended: boolean;
  goalReached: boolean;
}

export interface SiteFacts {
  now: number;
  createdAt: number;
  timeZone: string | null;
  platforms: Platform[];
  games: GameFact[];
  unlocks: UnlockFact[];
  cards: CardFact[];
  frame: boolean;
  showcase: boolean;
  push: boolean;
  friends: number;
  clan: { owner: boolean; size: number } | null;
  messages: number;
  comments: number;
  reactions: number;
  guideDone: boolean;
  upheldReport: boolean;
  doneFeedback: boolean;
  season: SeasonFacts | null;
  /** Le succès partagé avec un ami, le jeu fini le même jour, le jeu ouvert ou gardé pour soi. */
  soulmates: string | null;
  twins: string | null;
  perfectClan: boolean;
  firstEver: string | null;
  onlyOne: string | null;
  /** Les comptes des séries entre amis : jeux finis à deux, revanches, jours en synchro… */
  friendCounts: Record<FriendKey, number>;
  /** De quoi montrer chaque compte d'amis : les jeux ou succès, dans l'ordre des paliers. */
  friendProofs?: Partial<Record<FriendKey, FriendProof>>;
  /** Les amis acceptés, du plus ancien au plus récent. */
  friendIds?: string[];
  /** Le clan du joueur, pour les succès qui en parlent. */
  clanId?: string | null;
  /** Le succès de jeu derrière le guide terminé, le commentaire et la réaction qui comptent. */
  guideAchievementId?: string | null;
  // Vide pour un commentaire de guide : le palier compte, sans succès à montrer en preuve.
  commentAchievementIds?: (string | null)[];
  reactionAchievementId?: string | null;
  /** Un ami a commencé un jeu que le joueur avait laissé tomber. */
  badInfluence: string | null;
}

/** Un fait entre amis : les jeux ou succès dans l'ordre où le compte a monté, et l'ami concerné. */
export interface FriendProof {
  kind: 'games' | 'achievements';
  steps: { id: string; user: string | null }[];
}

/** Ce qui a déclenché un succès, pour l'expliquer au joueur. */
export interface SiteProof {
  games?: string[];
  achievements?: string[];
  /** Les joueurs qui ont compté : un ami, un coéquipier. */
  users?: string[];
  /** Le clan où le succès a été gagné. */
  clans?: string[];
}

/** Attribués par un geste, ou après tous les autres : aucune règle à relire ici. */
type DirectCode = 'stage_name' | 'painful_compare' | 'deserter' | 'last_word';

/** Une date lue à l'heure du joueur : utiliser les accesseurs `getUTC…`. */
export function localClock(timeZone: string | null) {
  if (!timeZone) return (at: number) => new Date(at);
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const offsetAt = (at: number) => {
    const parts = format.formatToParts(at);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const local = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    );
    return local - Math.floor(at / 1000) * 1000;
  };
  // Lire le fuseau coûte cher : une fois par heure suffit.
  const offsets = new Map<number, number>();
  return (at: number) => {
    const hour = Math.floor(at / HOUR);
    const offset = offsets.get(hour) ?? offsetAt(at);
    offsets.set(hour, offset);
    return new Date(at + offset);
  };
}

/** Marque les rafales d'un même jeu, comme le classement de saison. */
export function markBursts(unlocks: UnlockFact[], perSecond: number, perMinute: number) {
  for (const group of Map.groupBy(unlocks, (u) => u.gameId).values()) {
    for (const [size, span] of [
      [perSecond, 1000],
      [perMinute, 60_000],
    ] as const) {
      for (const slot of Map.groupBy(group, (u) => Math.floor(u.at / span)).values()) {
        if (slot.length >= size) for (const unlock of slot) unlock.burst = true;
      }
    }
  }
  return unlocks;
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

function longestRun(values: number[]) {
  const sorted = [...new Set(values)].toSorted((a, b) => a - b);
  let best = 0;
  let run = 0;
  sorted.forEach((value, index) => {
    run = value - 1 === sorted[index - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/** La première valeur qui complète une suite de `length` valeurs consécutives. */
function runEnd(values: number[], length: number) {
  const sorted = [...new Set(values)].toSorted((a, b) => a - b);
  let run = 0;
  return sorted.find((value, index) => {
    run = value - 1 === sorted[index - 1] ? run + 1 : 1;
    return run === length;
  });
}

const initial = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .charAt(0)
    .toUpperCase();

/** Les conditions, sans accès à la base : chaque succès tient en une ligne testable. */
export function evaluateSite(facts: SiteFacts) {
  const { games, unlocks, cards, platforms, season } = facts;
  const clock = localClock(facts.timeZone);
  const finished = games.filter(
    (g): g is GameFact & { lastAt: number } => g.completion >= 100 && g.lastAt !== null,
  );
  const stalled = games.filter((g) => g.completion >= 80 && g.completion < 100).length;
  const unfinished = games.filter((g) => g.total > 0 && g.completion < 100).length;
  /** Un jeu essayé : entre une minute et une heure. */
  const isQuick = (g: GameFact) => g.playtime >= 1 && g.playtime < 60;
  const quickGames = (list: GameFact[]) => list.filter(isQuick);
  const quick = (list: GameFact[]) => quickGames(list).length;

  const byGame = Map.groupBy(unlocks, (u) => u.gameId);
  for (const group of byGame.values()) group.sort((a, b) => a.at - b.at);
  const firstAt = (game: GameFact) => byGame.get(game.gameId)?.[0]?.at;
  const clean = (game: GameFact) => !byGame.get(game.gameId)?.some((u) => u.burst);
  const gapBeforeLast = (game: GameFact) => {
    const [last, previous] = (byGame.get(game.gameId) ?? []).toReversed();
    return last && previous ? last.at - previous.at : 0;
  };

  const dates = unlocks.map((u) => clock(u.at));
  const finishDates = finished.map((g) => clock(g.lastAt));
  const days = Map.groupBy(
    unlocks.filter((u) => !u.burst),
    (u) => dayKey(clock(u.at)),
  );
  const busiestDay = Math.max(0, ...[...days.values()].map((day) => day.length));
  const streak = longestRun(dates.map((date) => Math.floor(date.getTime() / DAY)));

  const rareUnlock = (limit: number) => (u: UnlockFact) =>
    u.rarity !== null && u.rarity > 0 && u.rarity < limit;
  const rare = (limit: number) => unlocks.filter(rareUnlock(limit)).length;
  const copies = (count: number) => cards.filter((card) => card.copies >= count);
  const tierCards = (tier: number) => cards.filter((card) => card.tier >= tier).length;
  // Une carte sortie d'une rafale ne prouve rien pour les combinaisons de niveaux.
  const earnedCards = cards.flatMap(({ tier, gameId, lastAt, copies: count }) => {
    const steady = !byGame.get(gameId)?.some((u) => u.burst);
    return steady && lastAt !== null ? [{ gameId, tier, count, date: clock(lastAt) }] : [];
  });
  const sameTierDay = Map.groupBy(earnedCards, ({ tier, date }) => `${tier}:${dayKey(date)}`);
  const cardDays = Map.groupBy(earnedCards, ({ date }) => dayKey(date));
  const ordered = earnedCards.toSorted((a, b) => a.date.getTime() - b.date.getTime());
  const monthTiers = Map.groupBy(earnedCards, ({ date }) => monthIndex(date));
  const cardCount = cards.length;
  const unlockCount = unlocks.length;
  const longest = Math.max(0, ...games.map((g) => g.playtime));
  const doneOn = new Set(finished.map((g) => g.platform));
  const seasonGames = season
    ? finished.filter((g) => {
        const started = (firstAt(g) ?? Infinity) < season.startsAt;
        return started && clean(g) && g.lastAt >= season.startsAt && g.lastAt < season.endsAt;
      })
    : [];
  const seasonFinishes = seasonGames.length;
  const isHare = (g: GameFact & { lastAt: number }) => {
    const first = firstAt(g);
    return g.total >= 30 && clean(g) && first !== undefined && g.lastAt - first < DAY;
  };
  const isNewGame = (g: GameFact) => {
    const first = firstAt(g);
    return g.completion < 80 && first !== undefined && facts.now - first <= WEEK;
  };
  const rarestLast = (g: GameFact) => {
    const group = byGame.get(g.gameId) ?? [];
    const last = group.at(-1)?.rarity;
    const known = last !== null && last !== undefined;
    return (
      known &&
      group.length >= 3 &&
      clean(g) &&
      group.every((u) => u.rarity !== null && u.rarity >= last)
    );
  };
  const byTime = unlocks.toSorted((a, b) => a.at - b.at);
  const returnIndex = byTime.findIndex(
    (u, index) => index > 0 && u.at - byTime[index - 1]!.at >= 30 * DAY,
  );

  const finishedByTime = finished.toSorted((a, b) => a.lastAt - b.lastAt);
  const tagged = (tags: readonly number[]) => (g: { gameId: string }) =>
    gameTags.get(g.gameId)?.some((tag) => tags.includes(tag)) ?? false;
  const gameTags = new Map(games.map((g) => [g.gameId, g.tags]));
  const genreKeys = Object.keys(GENRES) as (keyof typeof GENRES)[];
  const genresOf = (g: { gameId: string }) =>
    genreKeys.filter((key) => tagged(GENRES[key].tags)(g));
  /** Le jeu qui fait atteindre `count` genres différents finis à 100 %. */
  const tourGame = (count: number) => {
    const seen = new Set<string>();
    return finishedByTime.find((g) => {
      const before = seen.size;
      for (const key of genresOf(g)) seen.add(key);
      return before < count && seen.size >= count;
    });
  };
  const horror = tagged(GENRES.horror.tags);
  const gentle = (g: GameFact) => tagged(GENRES.cozy.tags)(g) || tagged(GENRES.cute.tags)(g);
  const moodDay = [...Map.groupBy(finished, (g) => dayKey(clock(g.lastAt))).values()].find(
    (day) => day.some(horror) && day.some(gentle),
  );
  const darkUnlock = facts.timeZone
    ? byTime.find((u) => clock(u.at).getUTCHours() < 4 && horror(u))
    : undefined;
  const comfortRun = finishedByTime.findIndex((_, index) => {
    const run = finishedByTime.slice(index, index + 10);
    return run.length === 10 && genreKeys.some((key) => run.every(tagged(GENRES[key].tags)));
  });

  const rules: Record<Exclude<BaseCode, DirectCode | ClanCode>, boolean> = {
    first_account: platforms.length >= 1,
    two_platforms: platforms.length >= 2,
    three_platforms: platforms.length >= 3,
    makeover: facts.frame,
    storefront: facts.showcase,
    ring_me: facts.push,

    cards_1: cardCount >= 1,
    cards_10: cardCount >= 10,
    cards_50: cardCount >= 50,
    cards_100: cardCount >= 100,
    cards_250: cardCount >= 250,
    gold_1: tierCards(3) >= 1,
    gold_10: tierCards(3) >= 10,
    gold_25: tierCards(3) >= 25,
    diamond_1: tierCards(4) >= 1,
    prismatic_1: tierCards(5) >= 1,
    bronze_25: cards.filter((card) => card.tier === 1).length >= 25,
    copies2_1: copies(2).length >= 1,
    copies2_5: copies(2).length >= 5,
    wide_gap: [...cardDays.values()].some((day) => {
      const tiers = day.map((card) => card.tier);
      return tiers.includes(1) && tiers.includes(6);
    }),
    reverse_gear: ordered.some(({ tier }, index) => {
      const next = ordered.slice(index + 1, index + 6);
      return tier >= 4 && next.length === 5 && next.every((card) => card.tier === 1);
    }),
    shiny_double: copies(2).some((card) => card.tier >= 3),
    second_helping: cards.some((card) => card.next),
    legendary: cards.some((card) => card.tier >= 6),
    game_100: finished.some((g) => g.total >= 100 && clean(g)),
    game_500: finished.some((g) => g.total >= 500 && clean(g)),
    small_10: finished.filter((g) => g.total <= 10).length >= 10,
    borderless: platforms.length >= 2 && platforms.every((platform) => doneOn.has(platform)),

    unlocks_100: unlockCount >= 100,
    unlocks_1000: unlockCount >= 1000,
    unlocks_5000: unlockCount >= 5000,
    unlocks_10000: unlockCount >= 10_000,
    unlocks_20000: unlockCount >= 20_000,

    rare_1: rare(1) >= 1,
    rare_50: rare(1) >= 50,
    ultra_rare: rare(0.1) >= 1,
    podium: Boolean(season?.ended && season.rank && season.rank <= 3 && season.points > 0),

    hours_100: longest >= 100 * 60,
    hours_1000: longest >= 1000 * 60,
    quick_1: quick(finished) >= 1,
    quick_5: quick(finished) >= 5,
    library_500: games.length >= 500,
    library_1000: games.length >= 1000,

    stalled_5: stalled >= 5,
    almost: games.some((g) => g.completion >= 95 && g.completion < 100),
    stalled_25: stalled >= 25,
    unfinished_100: unfinished >= 100,
    unfinished_500: unfinished >= 500,
    barely_played_50: quick(games) >= 50,
    sealed_100:
      games.filter(
        (g) => g.platform === 'STEAM' && g.playtime === 0 && g.unlocked === 0 && !g.played,
      ).length >= 100,
    resurrection: finished.some((g) => gapBeforeLast(g) > YEAR),
    one_left: finished.some((g) => g.total >= 5 && gapBeforeLast(g) >= WEEK),
    one_more_10: busiestDay >= 10,
    one_more_50: busiestDay >= 50,
    withdrawal: returnIndex >= 0,
    yet_another: stalled >= 5 && games.some(isNewGame),

    friend_1: facts.friends >= 1,
    friends_10: facts.friends >= 10,
    clan_join: facts.clan !== null,
    clan_5: Boolean(facts.clan?.owner && facts.clan.size >= 5),
    messages_100: facts.messages >= 100,
    comment_1: facts.comments >= 1,
    comments_50: facts.comments >= 50,
    reactions_10: facts.reactions >= 10,
    guide_done: facts.guideDone,
    snitch: facts.upheldReport,
    support: facts.doneFeedback,

    season_tier2: Boolean(season && season.points >= season.tiers[1]),
    season_tier3: Boolean(season && season.points >= season.tiers[2]),
    season_finish_1: seasonFinishes >= 1,
    season_finish_3: seasonFinishes >= 3,
    founder: Boolean(season && season.points >= season.tiers[0]),
    season_goal: Boolean(season?.goalReached && season.points > 0),

    midnight: unlocks.some((u) => u.at % DAY < 60_000),
    friday13: finishDates.some((date) => date.getUTCDay() === 5 && date.getUTCDate() === 13),
    birthday: finishDates.some((date) => {
      const created = clock(facts.createdAt);
      const anniversary = dayKey(created).slice(4) === dayKey(date).slice(4);
      return anniversary && date.getUTCFullYear() > created.getUTCFullYear();
    }),
    christmas: finishDates.some((date) => date.getUTCMonth() === 11 && date.getUTCDate() === 25),
    new_year: dates.some((date) => date.getUTCMonth() === 0 && date.getUTCDate() === 1),
    night_owl:
      facts.timeZone !== null &&
      dates.some((date) => date.getUTCHours() >= 3 && date.getUTCHours() < 5),
    monk: streak >= 30,
    world_tour: [...days.values()].some((day) => new Set(day.map((u) => u.platform)).size >= 3),
    hare: finished.some(isHare),
    alphabet: new Set(finished.map((g) => initial(g.name)).filter(Boolean)).size >= 20,
    rarest_last: finished.filter(rarestLast).length >= 5,
    nights_1001: unlockCount > 0 && unlockCount % 1001 === 0,
    forty_two: cardCount > 0 && cardCount % 42 === 0,
    soulmates: facts.soulmates !== null,
    bad_influence: facts.badInfluence !== null,
    twins: facts.twins !== null,
    perfect_clan: facts.perfectClan,
    grand_slam: copies(2).some(({ lastAt }) => {
      if (lastAt === null) return false;
      const near = (other: CardFact) =>
        other.lastAt !== null && Math.abs(lastAt - other.lastAt) <= WEEK;
      return cards.some((card) => card.tier >= 3 && near(card));
    }),
    full_set: new Set(cards.map((card) => card.tier)).size >= 6,
    four_of_a_kind: [...sameTierDay.values()].some((day) => day.length >= 4),
    straight: [...monthTiers.values()].some((month) => new Set(month.map((c) => c.tier)).size >= 5),
    legend_double: copies(2).some((card) => card.tier >= 6),
    six_months: longestRun(finishDates.map(monthIndex)) >= 6,
    first_ever: facts.firstEver !== null,
    only_one: facts.onlyOne !== null,
    mood_swing: moodDay !== undefined,
    dark_hours: darkUnlock !== undefined,
    comfort_zone: comfortRun >= 0,
    genre_tour_10: tourGame(10) !== undefined,
    genre_tour_20: tourGame(20) !== undefined,
    genre_tour_30: tourGame(30) !== undefined,
    genre_tour_40: tourGame(40) !== undefined,
  };
  const genreCodes = [...SITE_CATEGORIES.genres, ...SITE_CATEGORIES.themes].flatMap((code) => {
    const genre = genreOf(code);
    return genre ? [{ code: code as SiteCode, ...genre }] : [];
  });

  const gameProof = (ids: string[]): SiteProof => ({
    games: [...new Set(ids)].slice(0, MAX_PROOF),
  });
  const unlockProof = (list: UnlockFact[]): SiteProof => ({
    achievements: list.slice(0, MAX_PROOF).map((u) => u.achievementId),
  });
  const gamesOf = (list: { gameId: string }[]) => gameProof(list.map((g) => g.gameId));
  const userProof = (ids: string[] | undefined): SiteProof => ({ users: ids ?? [] });
  const clanProof = (id: string | null | undefined): SiteProof => ({ clans: id ? [id] : [] });
  const achievementProof = (id: string | null | undefined): SiteProof => ({
    achievements: id ? [id] : [],
  });
  /** Ce qui a fait monter une série d'amis : le jeu ou le succès du palier, et l'ami. */
  const friendProofOf = (code: SiteCode): SiteProof | undefined => {
    const series = seriesOf(code);
    if (!series || !(series.key in FRIEND_SERIES)) return undefined;
    const entry = facts.friendProofs?.[series.key as FriendKey];
    const step = entry?.steps[Math.min(series.count, entry.steps.length) - 1];
    if (!entry || !step) return undefined;
    return {
      ...(entry.kind === 'games' ? { games: [step.id] } : { achievements: [step.id] }),
      ...(step.user ? { users: [step.user] } : {}),
    };
  };

  const cardsByTime = cards
    .filter((card) => card.lastAt !== null)
    .toSorted((a, b) => a.lastAt! - b.lastAt!);
  /** Le palier se franchit avec la carte, le jeu ou le succès de ce rang. */
  const nthCard = (rank: number, keep: (card: CardFact) => boolean = () => true) =>
    gamesOf(cardsByTime.filter(keep).slice(rank - 1, rank));
  const nthFinished = (rank: number, keep: (game: GameFact) => boolean = () => true) =>
    gamesOf(finishedByTime.filter(keep).slice(rank - 1, rank));
  const nthUnlock = (rank: number, keep: (u: UnlockFact) => boolean = () => true) =>
    unlockProof(byTime.filter(keep).slice(rank - 1, rank));
  const atLeast = (tier: number) => (card: CardFact) => card.tier >= tier;
  const doubled = (card: CardFact) => card.copies >= 2;
  const finishedOn = (test: (date: Date) => boolean) => () =>
    nthFinished(1, (g) => g.lastAt !== null && test(clock(g.lastAt)));
  const firstDay = <T>(groups: Iterable<T[]>, test: (day: T[]) => boolean) =>
    [...groups].find(test) ?? [];
  const busiest = [...days.values()].toSorted((a, b) => b.length - a.length)[0] ?? [];
  const onePerPlatform = (day: UnlockFact[]) =>
    [...Map.groupBy(day, (u) => u.platform).values()].map((list) => list[0]!);
  const dayNumber = (at: number) => Math.floor(clock(at).getTime() / DAY);
  const streakProof = (length: number) => () => {
    const end = runEnd(
      unlocks.map((u) => dayNumber(u.at)),
      length,
    );
    return unlockProof(byTime.filter((u) => dayNumber(u.at) === end).slice(0, 1));
  };
  const stalledGames = () =>
    gamesOf(
      games
        .filter((g) => g.completion >= 80 && g.completion < 100)
        .toSorted((a, b) => b.completion - a.completion),
    );
  const longestGame = () => gamesOf(games.toSorted((a, b) => b.playtime - a.playtime).slice(0, 1));
  const firstDeepGap = (gap: number) => () =>
    gamesOf(finishedByTime.filter((g) => gapBeforeLast(g) >= gap).slice(0, 1));
  const lastLetter = () => {
    const letters = new Set<string>();
    return gamesOf(
      finishedByTime
        .filter((g) => {
          letters.add(initial(g.name));
          letters.delete('');
          return letters.size === 20;
        })
        .slice(0, 1),
    );
  };

  const proofs: Partial<Record<SiteCode, () => SiteProof>> = {
    mood_swing: () =>
      gamesOf([moodDay?.find(horror), moodDay?.find(gentle)].flatMap((g) => g ?? [])),
    dark_hours: () => unlockProof(darkUnlock ? [darkUnlock] : []),
    comfort_zone: () => gamesOf(finishedByTime.slice(comfortRun, comfortRun + 10)),
    genre_tour_10: () => gamesOf([tourGame(10)].flatMap((g) => g ?? [])),
    genre_tour_20: () => gamesOf([tourGame(20)].flatMap((g) => g ?? [])),
    genre_tour_30: () => gamesOf([tourGame(30)].flatMap((g) => g ?? [])),
    genre_tour_40: () => gamesOf([tourGame(40)].flatMap((g) => g ?? [])),
    ...Object.fromEntries(
      genreCodes.map(({ code, count, tags }) => [code, () => nthFinished(count, tagged(tags))]),
    ),
    cards_1: () => nthCard(1),
    cards_10: () => nthCard(10),
    cards_50: () => nthCard(50),
    cards_100: () => nthCard(100),
    cards_250: () => nthCard(250),
    gold_1: () => nthCard(1, atLeast(3)),
    gold_10: () => nthCard(10, atLeast(3)),
    gold_25: () => nthCard(25, atLeast(3)),
    diamond_1: () => nthCard(1, atLeast(4)),
    prismatic_1: () => nthCard(1, atLeast(5)),
    bronze_25: () => nthCard(25, (card) => card.tier === 1),
    copies2_1: () => nthCard(1, doubled),
    copies2_5: () => nthCard(5, doubled),
    shiny_double: () => nthCard(1, (card) => doubled(card) && card.tier >= 3),
    legend_double: () => nthCard(1, (card) => doubled(card) && card.tier >= 6),
    second_helping: () => nthCard(1, (card) => card.next),
    legendary: () => nthCard(1, atLeast(6)),
    wide_gap: () =>
      gamesOf(
        firstDay(
          cardDays.values(),
          (day) => day.some((c) => c.tier === 1) && day.some((c) => c.tier === 6),
        ),
      ),
    reverse_gear: () => {
      const start = ordered.findIndex(({ tier }, index) => {
        const next = ordered.slice(index + 1, index + 6);
        return tier >= 4 && next.length === 5 && next.every((card) => card.tier === 1);
      });
      return gamesOf(ordered.slice(start, start + 6));
    },
    game_100: () => nthFinished(1, (g) => g.total >= 100 && clean(g)),
    game_500: () => nthFinished(1, (g) => g.total >= 500 && clean(g)),
    small_10: () => nthFinished(10, (g) => g.total <= 10),
    borderless: () =>
      gamesOf([...Map.groupBy(finishedByTime, (g) => g.platform).values()].map((list) => list[0]!)),

    unlocks_100: () => nthUnlock(100),
    unlocks_1000: () => nthUnlock(1000),
    unlocks_5000: () => nthUnlock(5000),
    unlocks_10000: () => nthUnlock(10_000),
    unlocks_20000: () => nthUnlock(20_000),
    rare_1: () => nthUnlock(1, rareUnlock(1)),
    rare_50: () => nthUnlock(50, rareUnlock(1)),
    ultra_rare: () => nthUnlock(1, rareUnlock(0.1)),

    hours_100: longestGame,
    hours_1000: longestGame,
    quick_1: () => nthFinished(1, isQuick),
    quick_5: () => nthFinished(5, isQuick),

    stalled_5: stalledGames,
    almost: () =>
      gamesOf(games.filter((g) => g.completion >= 95 && g.completion < 100).slice(0, 1)),
    stalled_25: stalledGames,
    unfinished_100: () =>
      gamesOf(
        games
          .filter((g) => g.total > 0 && g.completion < 100)
          .toSorted((a, b) => b.completion - a.completion),
      ),
    unfinished_500: () =>
      gamesOf(
        games
          .filter((g) => g.total > 0 && g.completion < 100)
          .toSorted((a, b) => b.completion - a.completion),
      ),
    barely_played_50: () => gamesOf(quickGames(games)),
    sealed_100: () =>
      gamesOf(
        games.filter(
          (g) => g.platform === 'STEAM' && g.playtime === 0 && g.unlocked === 0 && !g.played,
        ),
      ),
    resurrection: firstDeepGap(YEAR + 1),
    one_left: () =>
      gamesOf(finishedByTime.filter((g) => g.total >= 5 && gapBeforeLast(g) >= WEEK).slice(0, 1)),
    one_more_10: () => unlockProof(busiest),
    one_more_50: () => unlockProof(busiest),
    withdrawal: () => unlockProof(byTime.slice(returnIndex, returnIndex + 1)),
    yet_another: () => gamesOf(games.filter(isNewGame).slice(0, 1)),

    season_finish_1: () => gamesOf(seasonGames),
    season_finish_3: () => gamesOf(seasonGames),

    midnight: () => nthUnlock(1, (u) => u.at % DAY < 60_000),
    friday13: finishedOn((date) => date.getUTCDay() === 5 && date.getUTCDate() === 13),
    birthday: finishedOn((date) => {
      const created = clock(facts.createdAt);
      const anniversary = dayKey(created).slice(4) === dayKey(date).slice(4);
      return anniversary && date.getUTCFullYear() > created.getUTCFullYear();
    }),
    christmas: finishedOn((date) => date.getUTCMonth() === 11 && date.getUTCDate() === 25),
    new_year: () => nthUnlock(1, (u) => dayKey(clock(u.at)).endsWith('-01-01')),
    night_owl: () =>
      nthUnlock(1, (u) => {
        const hour = clock(u.at).getUTCHours();
        return hour >= 3 && hour < 5;
      }),
    monk: streakProof(30),
    world_tour: () =>
      unlockProof(
        onePerPlatform(firstDay(days.values(), (day) => onePerPlatform(day).length >= 3)),
      ),
    hare: () => gamesOf(finishedByTime.filter(isHare).slice(0, 1)),
    alphabet: lastLetter,
    rarest_last: () => gamesOf(finishedByTime.filter(rarestLast)),
    nights_1001: () => nthUnlock(unlockCount),
    forty_two: () => nthCard(cardCount),
    soulmates: () => ({ achievements: facts.soulmates ? [facts.soulmates] : [] }),
    twins: () => gameProof(facts.twins ? [facts.twins] : []),
    grand_slam: () => {
      const near = (a: CardFact, b: CardFact) => Math.abs(a.lastAt! - b.lastAt!) <= WEEK;
      const pair = cardsByTime
        .filter(doubled)
        .find((a) => cardsByTime.some((b) => atLeast(3)(b) && near(a, b)));
      const gold = pair && cardsByTime.find((b) => atLeast(3)(b) && near(pair, b));
      return gamesOf(pair && gold ? [pair, gold] : []);
    },
    full_set: () =>
      gamesOf([...Map.groupBy(cardsByTime, (card) => card.tier).values()].map((list) => list[0]!)),
    four_of_a_kind: () => gamesOf(firstDay(sameTierDay.values(), (day) => day.length >= 4)),
    straight: () => {
      const month = firstDay(
        monthTiers.values(),
        (list) => new Set(list.map((c) => c.tier)).size >= 5,
      );
      return gamesOf([...Map.groupBy(month, (card) => card.tier).values()].map((list) => list[0]!));
    },
    six_months: () => {
      const end = runEnd(finishDates.map(monthIndex), 6) ?? 0;
      return gamesOf(
        finished.filter((g) => {
          const month = monthIndex(clock(g.lastAt));
          return month > end - 6 && month <= end;
        }),
      );
    },
    first_ever: () => gameProof(facts.firstEver ? [facts.firstEver] : []),
    only_one: () => gameProof(facts.onlyOne ? [facts.onlyOne] : []),
    bad_influence: () => gameProof(facts.badInfluence ? [facts.badInfluence] : []),

    friend_1: () => userProof(facts.friendIds?.slice(0, 1)),
    friends_10: () => userProof(facts.friendIds?.slice(9, 10)),
    clan_join: () => clanProof(facts.clanId),
    clan_5: () => clanProof(facts.clanId),
    perfect_clan: () => clanProof(facts.clanId),
    guide_done: () => achievementProof(facts.guideAchievementId),
    comment_1: () => achievementProof(facts.commentAchievementIds?.[0]),
    comments_50: () => achievementProof(facts.commentAchievementIds?.[49]),
    reactions_10: () => achievementProof(facts.reactionAchievementId),
  };

  const earnedGenres = genreCodes
    .filter(({ count, tags }) => finished.filter(tagged(tags)).length >= count)
    .map(({ code }) => code);
  const earnedWithFriends = (Object.entries(FRIEND_SERIES) as [FriendKey, readonly number[]][])
    .flatMap(([key, steps]) => steps.map((step) => ({ code: `${key}_${step}`, key, step })))
    .filter(({ key, step }) => facts.friendCounts[key] >= step)
    .map(({ code }) => code);
  const filled = (proof: SiteProof | undefined) =>
    Boolean(
      proof &&
      (proof.games?.length ||
        proof.achievements?.length ||
        proof.users?.length ||
        proof.clans?.length),
    );
  return {
    codes: [
      ...(Object.keys(rules) as (keyof typeof rules)[]).filter((code) => rules[code]),
      ...earnedGenres,
      ...earnedWithFriends,
    ] as SiteCode[],
    proof: (code: SiteCode) => {
      const proof = proofs[code]?.() ?? friendProofOf(code);
      return filled(proof) ? proof! : null;
    },
  };
}

export const earnedCodes = (facts: SiteFacts) => evaluateSite(facts).codes;
