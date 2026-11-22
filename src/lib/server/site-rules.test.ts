import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EVENT_CODES,
  GENRES,
  SITE_CATEGORIES,
  SITE_CODES,
  THEMES,
  challengeText,
  genreOf,
  seriesOf,
  tierOf,
} from '#lib/site-achievements';
import {
  earnedCodes,
  evaluateSite,
  localClock,
  markBursts,
  type GameFact,
  type SiteFacts,
  type UnlockFact,
} from './site-rules';

const DAY = 24 * 3_600_000;
const NOW = Date.UTC(2026, 10, 3, 12);

const facts = (extra: Partial<SiteFacts> = {}): SiteFacts => ({
  now: NOW,
  createdAt: Date.UTC(2020, 0, 1, 12),
  timeZone: null,
  platforms: [],
  games: [],
  unlocks: [],
  cards: [],
  frame: false,
  showcase: false,
  push: false,
  friends: 0,
  clan: null,
  messages: 0,
  comments: 0,
  reactions: 0,
  guideDone: false,
  upheldReport: false,
  doneFeedback: false,
  season: null,
  soulmates: null,
  twins: null,
  perfectClan: false,
  friendCounts: { duo: 0, revenge: 0, teammates: 0, synchro: 0, prescriber: 0, same_taste: 0 },
  badInfluence: null,
  ...extra,
});

const game = (gameId: string, extra: Partial<GameFact> = {}): GameFact => ({
  gameId,
  name: gameId,
  platform: 'STEAM',
  unlocked: 10,
  total: 10,
  completion: 100,
  playtime: 120,
  played: true,
  lastAt: NOW,
  tags: [],
  ...extra,
});

const HORROR = GENRES.horror.tags[0];
const CUTE = GENRES.cute.tags[0];

const unlock = (gameId: string, at: number, extra: Partial<UnlockFact> = {}): UnlockFact => ({
  at,
  gameId,
  achievementId: `${gameId}-${at}`,
  platform: 'STEAM',
  rarity: 50,
  ...extra,
});

const earned = (extra: Partial<SiteFacts>) => earnedCodes(facts(extra));

describe('succès du site', () => {
  it('réserve les métaux aux séries et distingue les succès uniques', () => {
    expect(tierOf('makeover')).toBe(0);
    expect(tierOf('first_account')).toBe(0);
    expect(tierOf('cards_1')).toBe(1);
    expect(tierOf('cards_10')).toBe(2);
    expect(tierOf('g_zombies_3')).toBe(2);
  });
  it('compte 667 succès permanents, dont 30 secrets, tous traduits', () => {
    expect(SITE_CODES.filter((code) => !EVENT_CODES.has(code))).toHaveLength(667);
    expect(new Set(SITE_CODES).size).toBe(SITE_CODES.length);
    expect(SITE_CATEGORIES.secret).toHaveLength(30);
    for (const locale of ['fr', 'en', 'de', 'es', 'pt-BR', 'ru', 'ja', 'zh-CN']) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'));
      for (const code of SITE_CODES) {
        // Les paliers d'une série partagent un titre et un texte.
        const key = challengeText(code)?.key ?? seriesOf(code)?.key ?? code;
        expect(messages[`ach_${key}_title`], `${locale} ${code}`).toBeTruthy();
        // Le texte d'un genre vient d'un modèle commun.
        if (!genreOf(code)) expect(messages[`ach_${key}_text`], `${locale} ${code}`).toBeTruthy();
      }
      for (const key of [...Object.keys(GENRES), ...Object.keys(THEMES)]) {
        expect(messages[`genre_${key}`], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it('gagne les paliers entre amis selon leurs comptes', () => {
    const counts = { duo: 5, revenge: 0, teammates: 3, synchro: 0, prescriber: 0, same_taste: 49 };
    const codes = earnedCodes(facts({ friendCounts: counts }));
    expect(codes).toEqual(
      expect.arrayContaining(['duo_1', 'duo_5', 'teammates_1', 'teammates_3', 'same_taste_10']),
    );
    expect(codes).not.toContain('duo_15');
    expect(codes).not.toContain('same_taste_50');
    expect(codes).not.toContain('revenge_1');
  });

  it('nomme le jeu et l’ami derrière chaque palier entre amis', () => {
    const steps = (ids: string[]) => ids.map((id) => ({ id, user: `ami-${id}` }));
    const { proof } = evaluateSite(
      facts({
        friendCounts: {
          duo: 5,
          revenge: 2,
          teammates: 0,
          synchro: 1,
          prescriber: 0,
          same_taste: 0,
        },
        friendProofs: {
          duo: { kind: 'games', steps: steps(['d1', 'd2', 'd3', 'd4', 'd5']) },
          revenge: { kind: 'games', steps: steps(['r1', 'r2']) },
          // Un jour en synchro se prouve par le succès débloqué ce jour-là.
          synchro: { kind: 'achievements', steps: steps(['s1']) },
        },
      }),
    );
    // Le palier 5 montre le cinquième jeu de la série, avec l'ami de ce jour-là.
    expect(proof('duo_1')).toEqual({ games: ['d1'], users: ['ami-d1'] });
    expect(proof('duo_5')).toEqual({ games: ['d5'], users: ['ami-d5'] });
    expect(proof('revenge_1')).toEqual({ games: ['r1'], users: ['ami-r1'] });
    expect(proof('synchro_1')).toEqual({ achievements: ['s1'], users: ['ami-s1'] });
  });

  it('nomme les joueurs et le clan derrière les succès sociaux', () => {
    const friends = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const comments = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const { proof } = evaluateSite(
      facts({
        friends: 10,
        friendIds: friends,
        clan: { owner: true, size: 5 },
        clanId: 'clan-1',
        comments: 50,
        commentAchievementIds: comments,
        reactions: 10,
        reactionAchievementId: 'react-1',
        guideDone: true,
        guideAchievementId: 'guide-1',
      }),
    );
    expect(proof('friend_1')).toEqual({ users: ['u0'] });
    expect(proof('friends_10')).toEqual({ users: ['u9'] });
    expect(proof('clan_join')).toEqual({ clans: ['clan-1'] });
    expect(proof('clan_5')).toEqual({ clans: ['clan-1'] });
    expect(proof('comment_1')).toEqual({ achievements: ['c0'] });
    expect(proof('comments_50')).toEqual({ achievements: ['c49'] });
    expect(proof('reactions_10')).toEqual({ achievements: ['react-1'] });
    expect(proof('guide_done')).toEqual({ achievements: ['guide-1'] });
  });

  it("n'accorde rien à un profil vide", () => {
    expect(earnedCodes(facts())).toEqual([]);
  });

  it('écarte les rafales des succès sensibles', () => {
    const start = Date.UTC(2025, 5, 1, 12);
    const rows = Array.from({ length: 120 }, (_, index) => unlock('a', start + index * 100));
    const code = earned({
      games: [game('a', { total: 120, lastAt: start + 12_000 })],
      unlocks: markBursts(rows, 20, 60),
    });
    expect(code).not.toContain('game_100');
    expect(code).not.toContain('one_more_10');
    expect(code).not.toContain('hare');

    const steady = Array.from({ length: 120 }, (_, index) =>
      unlock('a', start + index * 10 * 60_000),
    );
    expect(
      earned({
        games: [game('a', { total: 120, lastAt: start + 119 * 10 * 60_000 })],
        unlocks: markBursts(steady, 20, 60),
      }),
    ).toEqual(expect.arrayContaining(['game_100', 'one_more_50']));
  });

  it("lit les dates à l'heure du joueur", () => {
    const tokyo = localClock('Asia/Tokyo');
    expect(tokyo(Date.UTC(2026, 11, 24, 20)).getUTCDate()).toBe(25);
    const finish = Date.UTC(2025, 11, 24, 20);
    expect(earned({ games: [game('a', { lastAt: finish })] })).not.toContain('christmas');
    expect(earned({ games: [game('a', { lastAt: finish })], timeZone: 'Asia/Tokyo' })).toContain(
      'christmas',
    );
  });

  it("exige un fuseau connu pour l'heure tardive", () => {
    const unlocks = [unlock('a', Date.UTC(2026, 0, 2, 3, 30))];
    expect(earned({ unlocks })).not.toContain('night_owl');
    expect(earned({ unlocks, timeZone: 'UTC' })).toContain('night_owl');
  });

  it('suit les séries de jours et de mois', () => {
    const start = Date.UTC(2025, 0, 1, 12);
    const unlocks = Array.from({ length: 30 }, (_, index) => unlock('a', start + index * DAY));
    expect(earned({ unlocks })).toContain('monk');
    expect(earned({ unlocks: unlocks.slice(0, 29) })).not.toContain('monk');

    const games = Array.from({ length: 6 }, (_, index) =>
      game(`g${index}`, { lastAt: Date.UTC(2025, 9 + index, 10) }),
    );
    expect(earned({ games })).toContain('six_months');
    expect(earned({ games: games.slice(1) })).not.toContain('six_months');
  });

  it('ne confond pas temps inconnu et jeu vite fini', () => {
    const borrowed = game('a', { playtime: 0 });
    expect(earned({ games: [borrowed] })).not.toContain('quick_1');
    expect(earned({ games: [game('a', { playtime: 30 })] })).toContain('quick_1');
  });

  it('demande une carte sur chaque plateforme liée, deux au minimum', () => {
    const steam = game('a');
    const psn = game('b', { platform: 'PSN' });
    expect(earned({ platforms: ['STEAM'], games: [steam] })).not.toContain('borderless');
    expect(earned({ platforms: ['STEAM', 'PSN'], games: [steam] })).not.toContain('borderless');
    expect(earned({ platforms: ['STEAM', 'PSN'], games: [steam, psn] })).toContain('borderless');
  });

  it('tire parti des niveaux et des exemplaires', () => {
    const card = (tier: number, copies = 1, lastAt: number | null = NOW, gameId = 'x') => ({
      gameId,
      tier,
      copies,
      lastAt,
      next: false,
    });
    const code = earned({ cards: [card(3, 2), card(6, 4), { ...card(1), next: true }] });
    expect(code).toEqual(
      expect.arrayContaining([
        'gold_1',
        'diamond_1',
        'prismatic_1',
        'legendary',
        'shiny_double',
        'legend_double',
        'second_helping',
      ]),
    );
    expect(earned({ cards: [card(1, 2)] })).not.toContain('shiny_double');

    expect(earned({ cards: [1, 2, 3, 4, 5, 6].map((tier) => card(tier)) })).toContain('full_set');
    expect(earned({ cards: [1, 2, 3, 4, 5].map((tier) => card(tier)) })).toEqual(
      expect.arrayContaining(['straight']),
    );
    const four = [
      card(2, 1, NOW, 'a'),
      card(2, 1, NOW, 'b'),
      card(2, 1, NOW, 'c'),
      card(2, 1, NOW, 'd'),
    ];
    expect(earned({ cards: four })).toContain('four_of_a_kind');
    expect(earned({ cards: four.slice(1) })).not.toContain('four_of_a_kind');

    const tooled = [unlock('a', NOW, { burst: true })];
    expect(earned({ cards: four, unlocks: tooled })).not.toContain('four_of_a_kind');
  });

  it("reste obtenable quelle que soit l'ancienneté du compte", () => {
    const createdAt = Date.UTC(2020, 4, 10, 12);
    const games = [game('a', { lastAt: Date.UTC(2026, 4, 10, 12) })];
    expect(earned({ createdAt, games })).toContain('birthday');
    expect(earned({ createdAt, games: [game('a', { lastAt: createdAt })] })).not.toContain(
      'birthday',
    );
  });

  it('suit les enchaînements de cartes et les retours', () => {
    const card = (tier: number, day: number) => ({
      gameId: `g${day}`,
      tier,
      copies: 1,
      lastAt: NOW + day * DAY,
      next: false,
    });
    expect(earned({ cards: [card(1, 0), { ...card(6, 0), gameId: 'z' }] })).toContain('wide_gap');
    expect(earned({ cards: [card(1, 0), card(6, 1)] })).not.toContain('wide_gap');

    const bronze = [1, 2, 3, 4, 5].map((day) => card(1, day));
    expect(earned({ cards: [card(4, 0), ...bronze] })).toContain('reverse_gear');
    expect(earned({ cards: [card(4, 0), ...bronze.slice(1)] })).not.toContain('reverse_gear');

    const unlocks = [unlock('a', NOW - 40 * DAY), unlock('a', NOW)];
    expect(earned({ unlocks }).filter((code) => code.startsWith('withdrawal'))).toEqual([
      'withdrawal_7',
      'withdrawal_14',
      'withdrawal',
    ]);
    expect(earned({ unlocks: [unlock('a', NOW - 365 * DAY), unlock('a', NOW)] })).toContain(
      'withdrawal_365',
    );
    expect(earned({ unlocks: [unlock('a', NOW)] })).not.toContain('withdrawal');
  });

  it('retrouve ce qui a déclenché un succès', () => {
    const cards = [1, 2, 3].map((day) => ({
      gameId: `g${day}`,
      tier: 1,
      copies: 1,
      lastAt: NOW + day * DAY,
      next: false,
    }));
    const { proof } = evaluateSite(facts({ cards: [...cards, ...cards, ...cards, cards[0]!] }));
    expect(proof('cards_1')).toEqual({ games: ['g1'] });
    expect(proof('cards_10')).toEqual({ games: ['g3'] });

    const rare = evaluateSite(
      facts({
        unlocks: [unlock('a', NOW, { rarity: 50 }), unlock('b', NOW + DAY, { rarity: 0.05 })],
      }),
    );
    expect(rare.proof('ultra_rare')).toEqual({ achievements: [`b-${NOW + DAY}`] });
    expect(rare.proof('friend_1')).toBeNull();
  });

  it('classe la saison sur les jeux déjà commencés', () => {
    const season = {
      startsAt: Date.UTC(2026, 11, 1),
      endsAt: Date.UTC(2026, 11, 29),
      tiers: [100, 500, 2000] as const,
      points: 600,
      rank: 2,
      ended: true,
      goalReached: true,
    };
    const lastAt = Date.UTC(2026, 11, 10);
    const started = {
      games: [game('a', { lastAt })],
      unlocks: [unlock('a', Date.UTC(2026, 10, 1)), unlock('a', lastAt)],
      season,
    };
    expect(earned(started)).toEqual(
      expect.arrayContaining([
        'podium',
        'season_tier2',
        'founder',
        'season_finish_1',
        'season_goal',
      ]),
    );
    expect(earned(started)).not.toContain('season_tier3');
    expect(earned({ ...started, unlocks: [unlock('a', lastAt)] })).not.toContain('season_finish_1');
  });

  it('compte les jeux finis par genre, avec le jeu qui franchit le palier', () => {
    const horror = Array.from({ length: 5 }, (_, i) =>
      game(`h${i}`, { tags: [492, HORROR], lastAt: NOW - (5 - i) * DAY }),
    );
    const started = game('h-open', { tags: [HORROR], completion: 50 });
    const result = evaluateSite(facts({ games: [...horror, started, game('x')] }));
    expect(result.codes).toEqual(expect.arrayContaining(['g_horror_1', 'g_horror_5']));
    expect(result.codes).not.toContain('g_horror_15');
    expect(result.codes).not.toContain('g_cute_1');
    expect(result.proof('g_horror_5')).toEqual({ games: ['h4'] });
    expect(result.proof('g_horror_1')).toEqual({ games: ['h0'] });
  });

  it('fait le tour des genres', () => {
    const keys = Object.keys(GENRES) as (keyof typeof GENRES)[];
    const games = keys
      .slice(0, 10)
      .map((key, i) => game(key, { tags: [GENRES[key].tags[0]], lastAt: NOW - (10 - i) * DAY }));
    const result = evaluateSite(facts({ games }));
    expect(result.codes).toContain('genre_tour_10');
    expect(result.codes).not.toContain('genre_tour_20');
    expect(result.proof('genre_tour_10')).toEqual({ games: [keys[9]] });
    expect(earned({ games: games.slice(1) })).not.toContain('genre_tour_10');
  });

  it('passe de la peur à la douceur, et joue à l’horreur la nuit', () => {
    const day = Date.UTC(2026, 9, 10, 20);
    const games = [
      game('scary', { tags: [HORROR], lastAt: day }),
      game('sweet', { tags: [CUTE], lastAt: day + 3_600_000 }),
    ];
    expect(earned({ games })).toContain('mood_swing');
    expect(earned({ games: [games[0]!, { ...games[1]!, lastAt: day + 2 * DAY }] })).not.toContain(
      'mood_swing',
    );

    const night = Date.UTC(2026, 9, 10, 1, 30);
    const unlocks = [unlock('scary', night)];
    expect(earned({ games, unlocks })).not.toContain('dark_hours');
    expect(earned({ games, unlocks, timeZone: 'UTC' })).toContain('dark_hours');
    expect(earned({ games, unlocks: [unlock('sweet', night)], timeZone: 'UTC' })).not.toContain(
      'dark_hours',
    );
  });

  it('reste dans sa zone de confort dix jeux de suite', () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game(`c${i}`, { tags: [CUTE], lastAt: NOW - (10 - i) * DAY }),
    );
    expect(earned({ games })).toContain('comfort_zone');
    const broken = games.with(4, game('other', { lastAt: NOW - 6 * DAY }));
    expect(earned({ games: broken })).not.toContain('comfort_zone');
  });

  it('finit un jeu des années après, et deux le même jour', () => {
    const YEAR = 365 * DAY;
    const old = game('old', { lastAt: NOW });
    const start = unlock('old', NOW - 6 * YEAR);
    expect(earned({ games: [old], unlocks: [start] })).toContain('late_5');
    expect(earned({ games: [old], unlocks: [start] })).not.toContain('late_10');
    expect(earned({ games: [old], unlocks: [unlock('old', NOW - YEAR)] })).not.toContain('late_5');

    const pair = [game('a', { lastAt: NOW }), game('b', { lastAt: NOW + 3_600_000 })];
    expect(earned({ games: pair })).toContain('double_finish');
    expect(earned({ games: [pair[0]!, game('b', { lastAt: NOW + 2 * DAY })] })).not.toContain(
      'double_finish',
    );
  });

  it('enchaîne les jours, remplit un week-end et finit sans filet', () => {
    const daily = Array.from({ length: 7 }, (_, i) => unlock('g', NOW - i * DAY));
    expect(earned({ unlocks: daily })).toContain('streak_7');
    expect(earned({ unlocks: daily.slice(1) })).not.toContain('streak_7');

    // Un samedi puis le dimanche, assez espacés pour ne pas compter comme une rafale.
    const saturday = Date.UTC(2026, 9, 10, 8);
    const weekend = Array.from({ length: 100 }, (_, i) =>
      unlock(`w${i % 10}`, saturday + i * 20 * 60_000),
    );
    expect(earned({ unlocks: weekend })).toContain('weekend_100');
    const monday = weekend.map((u) => ({ ...u, at: u.at + 2 * DAY }));
    expect(earned({ unlocks: monday })).not.toContain('weekend_100');

    const hard = game('hard', { total: 5, unlocked: 5 });
    const hardUnlocks = (rarity: number) =>
      Array.from({ length: 5 }, (_, i) => unlock('hard', NOW - i * DAY, { rarity }));
    expect(earned({ games: [hard], unlocks: hardUnlocks(4) })).toContain('no_safety_net');
    expect(earned({ games: [hard], unlocks: hardUnlocks(12) })).not.toContain('no_safety_net');
  });

  it('compte le temps total, les premières marches du social et le guide utile', () => {
    const games = Array.from({ length: 20 }, (_, i) => game(`t${i}`, { playtime: 60 * 60 }));
    expect(earned({ games })).toContain('playtime_1000');
    expect(earned({ games })).not.toContain('playtime_5000');

    const social = earned({ friends: 3, messages: 10, comments: 10, reactions: 1 });
    expect(social).toEqual(
      expect.arrayContaining(['friends_3', 'messages_10', 'comments_10', 'reactions_1']),
    );
    expect(social).not.toContain('reactions_10');

    const guide = { score: 10, achievementId: 'a1', gameId: null };
    expect(earned({ bestGuide: guide })).toContain('guide_score_10');
    expect(earned({ bestGuide: { ...guide, score: 9 } })).not.toContain('guide_score_10');
    expect(evaluateSite(facts({ bestGuide: guide })).proof('guide_score_10')).toEqual({
      achievements: ['a1'],
    });
  });
});
