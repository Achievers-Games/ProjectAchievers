import { describe, expect, it, vi } from 'vitest';
import { PublicCache } from './public-cache';

describe('cache public borné', () => {
  it('ne duplique pas une requête encore en vol même si elle dure plus que le TTL', async () => {
    let now = 0,
      finish!: (value: number) => void;
    const cache = new PublicCache(2, () => now);
    const load = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const first = cache.read('podium', load);
    await Promise.resolve();
    now = 60_000;
    const second = cache.read('podium', load);
    finish(42);
    expect(await first).toBe(42);
    expect(await second).toBe(42);
    expect(load).toHaveBeenCalledOnce();
  });
  it('partage les requêtes simultanées et expire après le délai', async () => {
    let now = 0;
    const cache = new PublicCache(2, () => now);
    const load = vi.fn(async () => 42);
    expect(await Promise.all([cache.read('podium', load), cache.read('podium', load)])).toEqual([
      42, 42,
    ]);
    expect(load).toHaveBeenCalledOnce();
    now = 15001;
    await cache.read('podium', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ne réintroduit pas une ancienne donnée après invalidation pendant une requête', async () => {
    const cache = new PublicCache();
    let finish!: (value: number) => void;
    const old = cache.read(
      'podium',
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    cache.clear();
    expect(await cache.read('podium', async () => 2)).toBe(2);
    finish(1);
    await old;
    expect(await cache.read('podium', async () => 3)).toBe(2);
  });

  it('ne garde ni les erreurs ni un nombre illimité de clés', async () => {
    const cache = new PublicCache(2);
    await expect(
      cache.read('a', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await cache.read('a', async () => 1)).toBe(1);
    await cache.read('b', async () => 2);
    await cache.read('c', async () => 3);
    expect(await cache.read('a', async () => 4)).toBe(4);
  });
});
