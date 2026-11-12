// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pauseEffects } from './pause-effects';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('animations des cartes', () => {
  it('partage son observateur, suspend hors écran et dans un onglet masqué, puis reprend', () => {
    let callback!: IntersectionObserverCallback;
    const disconnect = vi.fn(),
      unobserve = vi.fn();
    const constructor = vi.fn(function (cb: IntersectionObserverCallback) {
      callback = cb;
      return { observe: vi.fn(), unobserve, disconnect };
    });
    vi.stubGlobal('IntersectionObserver', constructor);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const first = document.createElement('a'),
      second = document.createElement('a');
    const a = pauseEffects(first),
      b = pauseEffects(second);
    const enter = (target: HTMLElement, visible: boolean) =>
      callback(
        [
          {
            target,
            isIntersecting: visible,
            intersectionRatio: visible ? 1 : 0,
            time: 0,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
          },
        ],
        {} as IntersectionObserver,
      );
    expect(constructor).toHaveBeenCalledOnce();
    expect(first.dataset.effectsPaused).toBe('true');
    enter(first, true);
    expect(first.dataset.effectsPaused).toBe('false');
    expect(second.dataset.effectsPaused).toBe('true');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(first.dataset.effectsPaused).toBe('true');
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(first.dataset.effectsPaused).toBe('false');
    enter(first, false);
    expect(first.dataset.effectsPaused).toBe('true');
    a.destroy();
    b.destroy();
    expect(unobserve).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(first.dataset.effectsPaused).toBeUndefined();
  });
});
