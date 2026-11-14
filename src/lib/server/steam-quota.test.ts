import { afterEach, describe, expect, it, vi } from 'vitest';

describe('quota Steam', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('compte les appels par méthode et repart de zéro chaque jour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
    const { countSteamCall, steamCalls } = await import('./steam-quota');
    const before = steamCalls().total;
    countSteamCall('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=x');
    countSteamCall('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?steamid=1');
    countSteamCall('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?steamid=2');
    expect(steamCalls().total).toBe(before + 3);
    expect(steamCalls().byMethod.GetOwnedGames).toBe(2);

    vi.setSystemTime(new Date('2026-11-15T00:00:01Z'));
    expect(steamCalls()).toEqual({ total: 0, byMethod: {} });
  });
});
