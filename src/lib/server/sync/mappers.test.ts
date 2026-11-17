import { describe, expect, it, vi } from 'vitest';
import {
  isRealSc2Achievement,
  mapSc2Achievement,
  mergeUnlocks,
  sc2Unlocks,
  wowUnlocks,
} from './blizzard';
import { mapRetroAchievement, retroUnlocks } from './retro';
import { isComplete } from '#lib/collection';
import { fetchRetry, mapLimit, SyncError } from './errors';
import { assertPsnResponse, mapTrophy, noteLaunch } from './psn';
import { mapSchema, steamPlayedAt, unchangedSince } from './steam';
import {
  hasAchievements,
  mapXbox360Achievement,
  mapXboxAchievement,
  xboxImage,
  xboxMinutes,
  xboxUnlocks,
} from './xbox';

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

  it('ne saute un jeu que si Steam confirme qu’il n’a pas bougé', () => {
    const at = new Date('2026-10-31T14:37:00Z');
    const known = { lastPlayedAt: at, playtimeMinutes: 120 };
    expect(unchangedSince(known, at, 120)).toBe(true);
    expect(unchangedSince(known, at, 125)).toBe(false);
    expect(unchangedSince(known, new Date('2026-11-04T16:30:00Z'), 120)).toBe(false);
  });

  it('rejoue un jeu quand Steam n’envoie plus la date du dernier lancement', () => {
    // `GetOwnedGames` a cessé de renvoyer `rtime_last_played` : deux dates absentes ne sont
    // pas une preuve que rien n'a changé, sinon plus aucun succès n'arrive.
    expect(unchangedSince({ lastPlayedAt: null, playtimeMinutes: 0 }, null, 0)).toBe(true);
    expect(unchangedSince({ lastPlayedAt: null, playtimeMinutes: 15882 }, null, 16127)).toBe(false);
  });

  it('relit toujours un jeu joué ces deux dernières semaines', () => {
    // La relecture en direct a pu enregistrer le temps de jeu avant que Steam publie le succès.
    expect(unchangedSince({ lastPlayedAt: null, playtimeMinutes: 120 }, null, 120, 30)).toBe(false);
  });

  it('date le dernier lancement au temps de jeu qui grandit, sans jamais effacer la date connue', () => {
    const now = new Date('2026-11-16T20:00:00Z');
    // Steam la donne encore : elle fait foi.
    expect(
      steamPlayedAt({ rtime_last_played: 1_763_000_000, playtime_forever: 10 }, 10, now),
    ).toEqual(new Date(1_763_000_000_000));
    // Sans elle, du temps en plus prouve un lancement depuis la dernière lecture.
    expect(steamPlayedAt({ playtime_forever: 130 }, 120, now)).toEqual(now);
    // Rien de neuf, ou un jeu jamais vu : la date en base ne bouge pas.
    expect(steamPlayedAt({ playtime_forever: 120 }, 120, now)).toBeUndefined();
    expect(steamPlayedAt({ playtime_forever: 120 }, undefined, now)).toBeUndefined();
  });
});

describe('PSN', () => {
  it('date le dernier lancement d’un jeu, sans trophée gagné, et garde le plus récent', () => {
    const launched = new Map<string, Date>();
    noteLaunch(launched, 'PPSA01234_00', '2026-11-16T21:30:00Z');
    // Le même jeu revient plus ancien (autre région) : la date la plus récente reste.
    noteLaunch(launched, 'PPSA01234_00', '2026-10-01T10:00:00Z');
    // Une date absente ou illisible ne compte pas.
    noteLaunch(launched, 'CUSA00001_00', undefined);
    noteLaunch(launched, 'CUSA00002_00', 'pas une date');
    expect(launched).toEqual(new Map([['PPSA01234_00', new Date('2026-11-16T21:30:00Z')]]));
  });

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

describe('Xbox', () => {
  const fallback = new Date('2026-01-01T00:00:00Z');

  it('compte un succès obtenu, même sans date', () => {
    const unlocks = xboxUnlocks(
      [
        {
          id: '1',
          name: 'A',
          progressState: 'Achieved',
          progression: { timeUnlocked: '2025-05-01T10:00:00Z' },
        },
        { id: '2', name: 'B', progressState: 'achieved' },
        { id: '3', name: 'C', progressState: 'NotStarted' },
      ],
      fallback,
    );
    expect(unlocks).toEqual([
      { platformAchievementId: '1', unlockedAt: new Date('2025-05-01T10:00:00Z') },
      { platformAchievementId: '2', unlockedAt: fallback },
    ]);
  });

  it('garde un jeu dont seul le gamerscore annonce des succès', () => {
    const title = { titleId: '1', name: 'A' };
    expect(
      hasAchievements({ ...title, achievement: { totalAchievements: 0, totalGamerscore: 1000 } }),
    ).toBe(true);
    expect(hasAchievements({ ...title, achievement: { totalAchievements: 0 } })).toBe(false);
    expect(hasAchievements(title)).toBe(false);
  });

  it('sert les images Xbox en https, à une taille raisonnable', () => {
    expect(xboxImage('http://store-images.s-microsoft.com/image/a')).toBe(
      'https://store-images.s-microsoft.com/image/a?w=920',
    );
    expect(xboxImage('http://images-eds.xboxlive.com/a?x=1')).toBe(
      'https://images-eds.xboxlive.com/a?x=1',
    );
    expect(xboxImage(undefined)).toBeUndefined();
  });

  it('lit le format Xbox 360', () => {
    expect(
      mapXbox360Achievement({ id: 7, name: 'A', lockedDescription: 'B', gamerscore: 20 }),
    ).toMatchObject({
      platformAchievementId: '7',
      description: 'B',
      points: 20,
    });
  });

  it('lit les minutes jouées par titre et ignore les valeurs vides', () => {
    const minutes = xboxMinutes({
      statlistscollection: [
        {
          stats: [
            { name: 'MinutesPlayed', titleid: '1234', value: '125' },
            { name: 'MinutesPlayed', titleid: 5678, value: 40 },
            { name: 'MinutesPlayed', titleid: '9', value: '' },
            { name: 'MinutesPlayed', titleid: '10', value: 'n/a' },
            { name: 'Autre', titleid: '11', value: '3' },
          ],
        },
      ],
    });
    expect(Object.fromEntries(minutes)).toEqual({ '1234': 125, '5678': 40 });
    expect(xboxMinutes({}).size).toBe(0);
  });
});

describe('Battle.net', () => {
  it('fusionne les personnages en gardant la première date', () => {
    const merged = mergeUnlocks([
      wowUnlocks([
        { id: 1, completed_timestamp: 2_000 },
        { id: 2, completed_timestamp: 1_000 },
      ]),
      wowUnlocks([{ id: 1, completed_timestamp: 500 }, { id: 3 }]),
    ]);
    expect(merged).toEqual([
      { platformAchievementId: '1', unlockedAt: new Date(500) },
      { platformAchievementId: '2', unlockedAt: new Date(1_000) },
    ]);
  });

  it('lit les dates StarCraft II en secondes et ignore les succès en cours', () => {
    expect(
      sc2Unlocks([
        { achievementId: '9', completionDate: 1_504_035_656, isComplete: true },
        { achievementId: '10', isComplete: false },
      ]),
    ).toEqual([{ platformAchievementId: '9', unlockedAt: new Date(1_504_035_656_000) }]);
  });

  it('écarte les récompenses internes de StarCraft II', () => {
    const entry = (title: string, description: string, points = 10) => ({
      id: '1',
      title,
      description,
      points,
    });
    expect(
      isRealSc2Achievement(
        entry('Zero Hour', 'Complete all objectives in the "Zero Hour" mission.'),
      ),
    ).toBe(true);
    expect(isRealSc2Achievement(entry('Tychus: Level 10', 'Reach level 10 with Tychus.'))).toBe(
      true,
    );
    expect(
      isRealSc2Achievement(entry('5 Wins Streak: 2v2 Elite A.I.', 'Win 5 StarCraft II games.')),
    ).toBe(true);
    expect(
      isRealSc2Achievement(entry('No Time for Games', 'Secure 2 Stabilizers on Normal difficulty')),
    ).toBe(true);
    for (const fake of [
      entry('ffa25', 'Win 25 games.'),
      entry('250 Wins: Solo Protoss', '25 Wins: Solo Protoss'),
      entry('Reach level 5 with Fenix in Co-op Missions.', 'Win 3 games.'),
      entry('Zero Hour', 'Complete all objectives.', 0),
      entry('Day9VoicePackPurchase', 'Win 5 games.'),
      entry('Exploration_Co-op_Missions_Achievement_4 Criteria 2', 'Participant.'),
      entry('Commander Abathur Level 15 Criteria 1', 'Abathur: Level 14'),
      entry('Master Finals', '%userName% reached the finals'),
      entry('Hard: 1', 'Achievement/Description/DifficultyVeteran1'),
    ]) {
      expect(isRealSc2Achievement(fake)).toBe(false);
    }
  });

  it('garde les points réels, zéro compris', () => {
    const achievement = mapSc2Achievement({ id: '9', title: 'Maîtrise', points: 0 });
    expect(achievement.points).toBe(0);
    expect(achievement.description).toBe('');
  });
});

describe('RetroAchievements', () => {
  it('calcule la rareté sur les joueurs hardcore', () => {
    const mapped = mapRetroAchievement(
      { ID: 7, Title: 'A', Points: 10, BadgeName: '123', NumAwardedHardcore: 5 },
      200,
    );
    expect(mapped).toMatchObject({
      platformAchievementId: '7',
      points: 10,
      globalRarity: 2.5,
      iconUrl: 'https://media.retroachievements.org/Badge/123.png',
      iconLockedUrl: 'https://media.retroachievements.org/Badge/123_lock.png',
    });
    expect(mapRetroAchievement({ ID: 1, Title: 'A' }, 0).globalRarity).toBeNull();
  });

  it('ne compte que les déblocages hardcore, en heure UTC', () => {
    expect(
      retroUnlocks([
        { ID: 1, Title: 'A', DateEarnedHardcore: '2016-03-12 17:47:29' },
        { ID: 2, Title: 'B' },
      ]),
    ).toEqual([{ platformAchievementId: '1', unlockedAt: new Date('2016-03-12T17:47:29Z') }]);
  });
});
