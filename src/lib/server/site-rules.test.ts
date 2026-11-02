import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_CODES, SITE_CATEGORIES, SITE_CODES } from '$lib/site-achievements';
import {
  earnedCodes,
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
  soulmates: false,
  twins: false,
  perfectClan: false,
  firstEver: false,
  onlyOne: false,
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
  ...extra,
});

const unlock = (gameId: string, at: number, extra: Partial<UnlockFact> = {}): UnlockFact => ({
  at,
  gameId,
  platform: 'STEAM',
  rarity: 50,
  ...extra,
});

const earned = (extra: Partial<SiteFacts>) => earnedCodes(facts(extra));

describe('succès du site', () => {
  it('compte 100 succès permanents, dont 26 secrets, tous traduits', () => {
    expect(SITE_CODES.filter((code) => !EVENT_CODES.has(code))).toHaveLength(100);
    expect(new Set(SITE_CODES).size).toBe(SITE_CODES.length);
    expect(SITE_CATEGORIES.secret).toHaveLength(26);
    for (const locale of ['fr', 'en', 'de', 'es', 'pt-BR', 'ru', 'ja', 'zh-CN']) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'));
      for (const code of SITE_CODES) {
        expect(messages[`ach_${code}_title`], `${locale} ${code}`).toBeTruthy();
        expect(messages[`ach_${code}_text`], `${locale} ${code}`).toBeTruthy();
      }
    }
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
    expect(earned({ unlocks })).toContain('withdrawal');
    expect(earned({ unlocks: [unlock('a', NOW)] })).not.toContain('withdrawal');
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
});
