import { afterEach, describe, expect, it, vi } from 'vitest';
import { batchRefresh } from './refresh';

afterEach(() => vi.useRealTimers());
describe('rafraîchissement après synchronisation', () => {
  it('regroupe plusieurs fins de synchronisation en une seule relecture', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => {});
    const refresh = batchRefresh(read);
    refresh.request();
    refresh.request();
    refresh.request();
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledOnce();
    refresh.cancel();
  });
  it('rejoue une seule fois les événements arrivés pendant une relecture, sans chevauchement', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const refresh = batchRefresh(read);
    refresh.request();
    await vi.advanceTimersByTimeAsync(250);
    refresh.request();
    refresh.request();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
    refresh.cancel();
  });
  it('annule le rafraîchissement en attente quand le composant disparaît', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => {});
    const refresh = batchRefresh(read);
    refresh.request();
    refresh.cancel();
    refresh.request();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
  });
});
