import { afterEach, describe, expect, it } from 'vitest';
import { markRunning, markStopped } from './crash-alert';

describe('témoin de plantage', () => {
  afterEach(() => markStopped());

  it('ne signale rien après un arrêt propre', () => {
    markStopped();
    expect(markRunning(new Date('2026-11-17T10:00:00Z'))).toBeNull();
  });

  it('rend l’heure de démarrage du processus mort sans arrêt propre', () => {
    markStopped();
    markRunning(new Date('2026-11-17T10:00:00Z'));
    // Relancé par Docker sans être passé par l'arrêt propre.
    expect(markRunning(new Date('2026-11-17T11:00:00Z'))).toBe('2026-11-17T10:00:00.000Z');
    expect(markRunning(new Date('2026-11-17T12:00:00Z'))).toBe('2026-11-17T11:00:00.000Z');
  });
});
