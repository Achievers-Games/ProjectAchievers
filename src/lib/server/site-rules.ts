import type { Platform } from '@prisma/client';
import type { SiteCode } from '$lib/site-achievements';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

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
}

export interface UnlockFact {
  at: number;
  gameId: string;
  platform: Platform;
  rarity: number | null;
  /** Rafale : un outil ou une synchronisation plutôt qu'une partie. */
  burst?: boolean;
}

export interface CardFact {
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
  soulmates: boolean;
  twins: boolean;
  perfectClan: boolean;
  firstEver: boolean;
  onlyOne: boolean;
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

const initial = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .charAt(0)
    .toUpperCase();

/** Les conditions, sans accès à la base : chaque succès tient en une ligne testable. */
export function earnedCodes(facts: SiteFacts): SiteCode[] {
  const { games, unlocks, cards, platforms, season } = facts;
  const clock = localClock(facts.timeZone);
  const finished = games.filter(
    (g): g is GameFact & { lastAt: number } => g.completion >= 100 && g.lastAt !== null,
  );
  const stalled = games.filter((g) => g.completion >= 80 && g.completion < 100).length;
  const unfinished = games.filter((g) => g.total > 0 && g.completion < 100).length;
  const quick = (list: GameFact[]) => list.filter((g) => g.playtime >= 1 && g.playtime < 60).length;

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

  const rare = (limit: number) =>
    unlocks.filter((u) => u.rarity !== null && u.rarity > 0 && u.rarity < limit).length;
  const copies = (count: number) => cards.filter((card) => card.copies >= count);
  const tierCards = (tier: number) => cards.filter((card) => card.tier >= tier).length;
  // Une carte sortie d'une rafale ne prouve rien pour les combinaisons de niveaux.
  const earnedCards = cards.flatMap(({ tier, gameId, lastAt }) => {
    const steady = !byGame.get(gameId)?.some((u) => u.burst);
    return steady && lastAt !== null ? [{ tier, date: clock(lastAt) }] : [];
  });
  const sameTierDay = Map.groupBy(earnedCards, ({ tier, date }) => `${tier}:${dayKey(date)}`);
  const cardDays = Map.groupBy(earnedCards, ({ date }) => dayKey(date));
  const ordered = earnedCards.toSorted((a, b) => a.date.getTime() - b.date.getTime());
  const monthTiers = Map.groupBy(earnedCards, ({ date }) => monthIndex(date));
  const cardCount = cards.length;
  const unlockCount = unlocks.length;
  const longest = Math.max(0, ...games.map((g) => g.playtime));
  const doneOn = new Set(finished.map((g) => g.platform));
  const seasonFinishes = season
    ? finished.filter((g) => {
        const started = (firstAt(g) ?? Infinity) < season.startsAt;
        return started && clean(g) && g.lastAt >= season.startsAt && g.lastAt < season.endsAt;
      }).length
    : 0;

  const rules: Record<Exclude<SiteCode, DirectCode>, boolean> = {
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
    withdrawal: unlocks
      .map((u) => u.at)
      .toSorted((a, b) => a - b)
      .some((at, index, sorted) => index > 0 && at - sorted[index - 1]! >= 30 * DAY),
    yet_another:
      stalled >= 5 &&
      games.some((g) => {
        const first = firstAt(g);
        return g.completion < 80 && first !== undefined && facts.now - first <= WEEK;
      }),

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
    hare: finished.some((g) => {
      const first = firstAt(g);
      return g.total >= 30 && clean(g) && first !== undefined && g.lastAt - first < DAY;
    }),
    alphabet: new Set(finished.map((g) => initial(g.name)).filter(Boolean)).size >= 20,
    rarest_last:
      finished.filter((g) => {
        const group = byGame.get(g.gameId) ?? [];
        const last = group.at(-1)?.rarity;
        const known = last !== null && last !== undefined;
        return (
          known &&
          group.length >= 3 &&
          clean(g) &&
          group.every((u) => u.rarity !== null && u.rarity >= last)
        );
      }).length >= 5,
    nights_1001: unlockCount > 0 && unlockCount % 1001 === 0,
    forty_two: cardCount > 0 && cardCount % 42 === 0,
    soulmates: facts.soulmates,
    twins: facts.twins,
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
    first_ever: facts.firstEver,
    only_one: facts.onlyOne,
  };

  return (Object.keys(rules) as (keyof typeof rules)[]).filter((code) => rules[code]);
}
