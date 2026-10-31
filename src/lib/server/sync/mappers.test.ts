import { describe, expect, it, vi } from 'vitest';
import { isComplete } from '$lib/collection';
import { fetchRetry, mapLimit, SyncError } from './errors';
import { assertPsnResponse, mapTrophy } from './psn';
import { mapSchema } from './steam';
import { mapXboxAchievement } from './xbox';

describe('cartes', () => {
  it('ne donne une carte qu’à un vrai 100 %, même avec le trophée platine', () => {
    const progress = { unlockedCount: 51, completion: 52, platinum: true };
    expect(isComplete(progress)).toBe(false);
    expect(isComplete({ ...progress, completion: 100 })).toBe(true);
  });
});

describe('réponses PSN', () => {
  it('explique des trophées privés, renvoyés sans exception par psn-api', () => {
    const response = { error: { code: 2240526, message: 'Not permitted by access control' } };
    expect(() => assertPsnResponse(response)).toThrow(SyncError);
    expect(() => assertPsnResponse(response)).toThrow('sync_psn_private');
  });

  it('laisse passer une réponse normale et signale les autres erreurs', () => {
    expect(() => assertPsnResponse({ trophyTitles: [] })).not.toThrow();
    expect(() => assertPsnResponse({ error: { code: 1, message: 'panne' } })).toThrow('panne');
  });
});

describe('Steam', () => {
  it('lit displayName et les URL complètes du schéma', () => {
    const [mapped] = mapSchema(
      [
        {
          name: 'ACH_1',
          displayName: 'Premier pas',
          description: 'Commencer',
          hidden: 1,
          icon: 'https://cdn.test/a.jpg',
          icongray: 'https://cdn.test/b.jpg',
        },
      ],
      new Map([['ACH_1', 12.5]]),
    );
    expect(mapped).toMatchObject({
      platformAchievementId: 'ACH_1',
      name: 'Premier pas',
      iconUrl: 'https://cdn.test/a.jpg',
      hidden: true,
      globalRarity: 12.5,
    });
  });
});

describe('PSN', () => {
  it('convertit le type et la rareté', () => {
    expect(
      mapTrophy({
        trophyId: 7,
        trophyType: 'platinum',
        trophyName: 'Maître',
        trophyHidden: false,
        trophyEarnedRate: '3.4',
      }),
    ).toMatchObject({ platformAchievementId: '7', trophyType: 'PLATINUM', globalRarity: 3.4 });
  });
});

describe('Xbox', () => {
  it('utilise le Gamerscore comme points', () => {
    expect(
      mapXboxAchievement({
        id: '1',
        name: 'Victoire',
        lockedDescription: 'Gagner',
        rewards: [{ type: 'Gamerscore', value: '25' }],
        rarity: { currentPercentage: 8 },
      }),
    ).toMatchObject({ description: 'Gagner', points: 25, globalRarity: 8 });
  });
});

describe('utilitaires de synchronisation', () => {
  it('respecte la limite de concurrence', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });
    expect(peak).toBe(2);
  });

  it('réessaie après un 429 en respectant Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0.01' } }))
      .mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchRetry('https://api.test');
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
