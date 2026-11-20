import { describe, expect, it } from 'vitest';
import { steamReviewState } from './steam-review-state';

const review = {
  status: 'PENDING' as const,
  suspendedAt: null,
  openedAt: new Date('2026-11-20'),
};

describe('steamReviewState', () => {
  it('distingue les jeux en attente, bloqués et débloqués', () => {
    expect(steamReviewState(review)).toBe('pending');
    expect(steamReviewState({ ...review, suspendedAt: new Date() })).toBe('blocked');
    expect(steamReviewState({ ...review, status: 'REJECTED' })).toBe('blocked');
    expect(steamReviewState({ ...review, status: 'APPROVED' })).toBe('unblocked');
  });

  it('tait une validation automatique jamais ouverte', () => {
    expect(steamReviewState({ ...review, status: 'APPROVED', openedAt: new Date(0) })).toBeNull();
  });
});
