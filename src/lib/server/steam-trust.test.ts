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

  it('ne valide jamais sur le seul temps de jeu, qu’un outil peut gonfler', () => {
    // 70 h pour 44 succès, sans autre trace : en attente.
    expect(steamTrust({ ...base, playtime: 70 * 60 })).toMatchObject({
      score: 2,
      verdict: 'review',
    });
    // Lies of P : 10,7 h dont 7,7 h hors ligne pour 42 succès. Le jeu hors ligne fait la différence.
    expect(steamTrust({ ...base, unlocked: 42, playtime: 642, offline: 462 })).toMatchObject({
      score: 4,
      verdict: 'trusted',
    });
  });

  it('compare au temps médian des autres membres quand ils sont assez nombreux', () => {
    const peers = { peerMedian: 60 * 60, peers: 5 };
    expect(steamTrust({ ...base, ...peers, playtime: 40 * 60 }).verdict).toBe('review');
    expect(steamTrust({ ...base, ...peers, playtime: 40 * 60, history: 5 }).verdict).toBe(
      'trusted',
    );
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

  it('ne condamne pas un jeu qui reprend une progression d’ailleurs', () => {
    const imported = { ...base, unlocked: 30, playtime: 12, crossProgress: true };
    expect(steamTrust(imported)).toMatchObject({ score: 0, verdict: 'review' });
    expect(steamTrust({ ...imported, nearImpossible: 3 }).verdict).toBe('review');
  });

  it('valide sur la foi du même jeu joué sur un autre compte lié', () => {
    const other = { platform: 'XBOX', completion: 80, minutes: 0 };
    // 10 min sur Steam ne pèsent plus : la progression vient du compte Xbox.
    expect(steamTrust({ ...base, playtime: 10, otherPlatform: other })).toMatchObject({
      score: 3,
      verdict: 'trusted',
    });
    expect(
      steamTrust({ ...base, otherPlatform: { platform: 'XBOX', completion: 5, minutes: 30 } })
        .score,
    ).toBe(1);
  });

  it('ne valide pas un gros lot sur le temps de jeu et l’historique seuls', () => {
    // Bongo Cat : 99 h, quelques succès étalés avant, puis 18 succès sur 28 à la même seconde.
    const bongo = {
      ...base,
      unlocked: 28,
      playtime: 5940,
      history: 3,
      largestBatch: 18,
      total: 28,
    };
    expect(steamTrust(bongo)).toMatchObject({
      score: 3,
      verdict: 'review',
      signals: expect.arrayContaining([
        expect.objectContaining({ kind: 'large_batch', count: 18 }),
      ]),
    });
    // Du jeu hors ligne compté par Steam explique le lot : il passe.
    expect(steamTrust({ ...bongo, offline: 600 }).verdict).toBe('trusted');
    // Un petit lot reste jugé sur le score, comme avant.
    expect(steamTrust({ ...bongo, largestBatch: 4 }).verdict).toBe('trusted');
  });
});
