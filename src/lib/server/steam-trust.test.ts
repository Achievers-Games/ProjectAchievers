import { describe, expect, it } from 'vitest';
import { steamTrust, type TrustEvidence } from './steam-integrity';

const base: TrustEvidence = {
  unlocked: 44,
  playtime: null,
  offline: 0,
  peerMedian: null,
  peers: 0,
  history: 0,
  nearImpossible: 0,
};

describe('steamTrust', () => {
  it('laisse en revue un lot sans temps de jeu connu', () => {
    expect(steamTrust(base)).toMatchObject({ score: 0, verdict: 'review' });
  });

  it('valide une complétion avec un temps de jeu à la hauteur', () => {
    // Lies of P : 44 succès, 70 h de jeu, tout arrivé à la même seconde.
    expect(steamTrust({ ...base, playtime: 70 * 60 }).verdict).toBe('trusted');
  });

  it('compare au temps médian des autres membres quand ils sont assez nombreux', () => {
    const peers = { peerMedian: 60 * 60, peers: 5 };
    expect(steamTrust({ ...base, ...peers, playtime: 40 * 60 }).verdict).toBe('trusted');
    expect(steamTrust({ ...base, ...peers, playtime: 3 * 60 }).verdict).toBe('cheat');
    // Deux pairs ne suffisent pas : la règle par succès reprend la main.
    expect(steamTrust({ ...base, peerMedian: 60 * 60, peers: 2, playtime: 40 * 60 })).toMatchObject(
      { signals: [expect.objectContaining({ kind: 'playtime_rate' })] },
    );
  });

  it('condamne une liste complète obtenue en quelques minutes', () => {
    expect(steamTrust({ ...base, unlocked: 30, playtime: 12 })).toMatchObject({
      score: -3,
      verdict: 'cheat',
    });
  });

  it('additionne le jeu hors ligne, l’historique et les succès presque impossibles', () => {
    // 10 min par succès : rien d'un côté ni de l'autre, le jeu hors ligne et l'historique font le reste.
    const middling = { ...base, unlocked: 30, playtime: 300 };
    expect(steamTrust(middling).score).toBe(0);
    expect(steamTrust({ ...middling, offline: 120, history: 5 }).verdict).toBe('trusted');
    expect(steamTrust({ ...base, unlocked: 30, playtime: 60, nearImpossible: 3 }).verdict).toBe(
      'cheat',
    );
  });
});
