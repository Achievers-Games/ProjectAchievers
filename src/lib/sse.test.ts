import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeJson } from './sse';

class FakeSource {
  static last: FakeSource;
  onmessage: ((message: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSource.last = this;
  }

  close() {
    this.closed = true;
  }

  emit(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('flux d’événements JSON', () => {
  it('transmet les trames valides et ignore les trames abîmées', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const received: unknown[] = [];
    subscribeJson('/api/sync/events', (event) => received.push(event));

    expect(FakeSource.last.url).toBe('/api/sync/events');
    FakeSource.last.emit('{"type":"card","tier":3}');
    FakeSource.last.emit('pas du tout du JSON');
    FakeSource.last.emit('{"type":"chat","id":"1"}');

    expect(received).toEqual([
      { type: 'card', tier: 3 },
      { type: 'chat', id: '1' },
    ]);
  });

  it('prévient à l’ouverture et ferme le flux quand on se désabonne', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const onOpen = vi.fn();
    const unsubscribe = subscribeJson('/api/presence', () => {}, onOpen);

    FakeSource.last.onopen?.();
    expect(onOpen).toHaveBeenCalledOnce();

    unsubscribe();
    expect(FakeSource.last.closed).toBe(true);
  });

  it('n’impose pas de rappel d’ouverture', () => {
    vi.stubGlobal('EventSource', FakeSource);
    expect(() => subscribeJson('/api/sync/events', () => {})()).not.toThrow();
    expect(FakeSource.last.closed).toBe(true);
  });
});
