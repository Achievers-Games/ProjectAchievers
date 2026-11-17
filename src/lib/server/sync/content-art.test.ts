import { afterEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../db', () => ({
  db: {
    game: { findMany: (...args: unknown[]) => findMany(...args), update: vi.fn(() => ({})) },
    $transaction: vi.fn(async () => []),
  },
}));

const { artNow } = await import('./content');

const game = {
  id: 'g1',
  platform: 'STEAM',
  platformGameId: '620',
  name: 'Portal 2',
  familyKey: null,
};

describe('capture lue à la demande', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ne lit qu’une fois un jeu demandé par plusieurs visiteurs en même temps', async () => {
    findMany.mockResolvedValue([game]);
    let release = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ response: { store_items: [] } }));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = artNow(['g1']);
    const second = artNow(['g1']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    let secondDone = false;
    void second.then(() => (secondDone = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Le second visiteur attend la lecture en cours au lieu de repartir sans image.
    expect(secondDone).toBe(false);
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('relit un jeu une fois la lecture précédente terminée', async () => {
    findMany.mockResolvedValue([game]);
    const fetchMock = vi.fn(async () => Response.json({ response: { store_items: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await artNow(['g1']);
    await artNow(['g1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
