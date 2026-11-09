// Tests sur un vrai PostgreSQL : ce que Lure sait d'un jeu, gardé pour sa fiche Achievers.
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './db';
import { env } from './env';
import { lureGameFor, parseLureGame } from './lure-games';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
const saved = { ...env() };
beforeAll(() => {
  Object.assign(env(), { LURE_API_URL: 'https://lure.test', LURE_API_KEY: 'lure_pk_test' });
});
afterAll(async () => {
  Object.assign(env(), { LURE_API_URL: saved.LURE_API_URL, LURE_API_KEY: saved.LURE_API_KEY });
  await db.lureGame.deleteMany({ where: { steamAppId: { startsWith: PREFIX } } });
});

const appid = () => `${PREFIX}-${Math.random().toString(36).slice(2)}`;
const steam = (platformGameId = appid(), familyKey: string | null = null) => ({
  platform: 'STEAM' as const,
  platformGameId,
  familyKey,
});

/** Un faux Lure : il répond ce qu'on lui dit et compte les appels. */
function fakeLure(status: number, body: unknown = {}) {
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('réponse de Lure', () => {
  it('lit les temps en minutes et garde une adresse https seulement', () => {
    expect(
      parseLureGame(
        {
          url: 'https://lureverse.fr/jeu/219150',
          time_to_beat: { main_minutes: 180, normal_minutes: 330, completionist_minutes: 720 },
        },
        'https://lureverse.fr/jeu/x',
      ),
    ).toEqual({
      url: 'https://lureverse.fr/jeu/219150',
      mainMinutes: 180,
      normalMinutes: 330,
      completionistMinutes: 720,
    });
    expect(
      parseLureGame(
        { game: { url: 'javascript:alert(1)', time_to_beat: { completionist_minutes: -3 } } },
        'https://lureverse.fr/jeu/1',
      ),
    ).toMatchObject({ url: 'https://lureverse.fr/jeu/1', completionistMinutes: null });
    expect(parseLureGame(null, 'https://lureverse.fr/jeu/1')).toBeNull();
  });
});

describe('fiche Lure d’un jeu', () => {
  it('interroge Lure avec la clé, garde la réponse et ne la redemande pas avant une semaine', async () => {
    const game = steam();
    const lure = fakeLure(200, { time_to_beat: { completionist_minutes: 720 } });
    const now = Date.now();
    const info = await lureGameFor(game, { now, fetcher: lure.fetcher, wait: true });
    expect(info).toEqual({
      url: `https://lure.test/jeu/${game.platformGameId}`,
      mainMinutes: null,
      normalMinutes: null,
      completionistMinutes: 720,
    });
    expect(lure.calls).toEqual([
      `https://lure.test/api/v1/games/${game.platformGameId} Bearer lure_pk_test`,
    ]);

    await lureGameFor(game, { now: now + 6 * 24 * 3600 * 1000, fetcher: lure.fetcher, wait: true });
    expect(lure.calls).toHaveLength(1);
    await lureGameFor(game, { now: now + 8 * 24 * 3600 * 1000, fetcher: lure.fetcher, wait: true });
    expect(lure.calls).toHaveLength(2);
  });

  it('ne montre rien pour un jeu inconnu de Lure, et garde l’ancienne fiche pendant une panne', async () => {
    const game = steam();
    expect(await lureGameFor(game, { fetcher: fakeLure(404).fetcher, wait: true })).toBeNull();
    expect(
      await db.lureGame.findUnique({ where: { steamAppId: game.platformGameId } }),
    ).toMatchObject({ found: false });

    const known = steam();
    const now = Date.now();
    await lureGameFor(known, {
      now,
      fetcher: fakeLure(200, { time_to_beat: { main_minutes: 60 } }).fetcher,
      wait: true,
    });
    const later = await lureGameFor(known, {
      now: now + 8 * 24 * 3600 * 1000,
      fetcher: fakeLure(503).fetcher,
      wait: true,
    });
    expect(later?.mainMinutes).toBe(60);
  });

  it('passe par l’appid Steam pour un jeu PSN', async () => {
    const family = appid();
    const steamGame = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: appid(),
        name: `${PREFIX} Lure`,
        slug: appid(),
        familyKey: family,
      },
    });
    const lure = fakeLure(200, { time_to_beat: { completionist_minutes: 90 } });
    const info = await lureGameFor(
      { platform: 'PSN', platformGameId: 'NPWR0', familyKey: family },
      { fetcher: lure.fetcher, wait: true },
    );
    expect(lure.calls[0]).toContain(`/api/v1/games/${steamGame.platformGameId} `);
    expect(info?.completionistMinutes).toBe(90);
    expect(
      await lureGameFor({ platform: 'XBOX', platformGameId: 'x', familyKey: null }, { wait: true }),
    ).toBeNull();
  });
});
