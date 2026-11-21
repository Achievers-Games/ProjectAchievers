import { afterEach, describe, expect, it } from 'vitest';
import { canSeeCards, setCardsOpeningForTests, shardsStart } from './cards-launch';

const member = { role: 'USER' } as App.Locals['user'];
const moderator = { role: 'MODERATOR' } as App.Locals['user'];

describe('ouverture des éclats', () => {
  afterEach(() => setCardsOpeningForTests(new Date(0)));

  it('cache tout aux membres tant que c’est fermé, pas à la modération', () => {
    setCardsOpeningForTests(null);
    expect(canSeeCards(null)).toBe(false);
    expect(canSeeCards(member)).toBe(false);
    expect(canSeeCards(moderator)).toBe(true);
    expect(shardsStart(new Date('2026-01-01'))).toBeNull();
  });

  it('fait partir les gains de l’ouverture, ou de l’inscription si elle est plus tardive', () => {
    const opening = new Date('2027-01-01');
    setCardsOpeningForTests(opening);
    expect(canSeeCards(member)).toBe(true);
    expect(shardsStart(new Date('2026-06-01'))).toEqual(opening);
    expect(shardsStart(new Date('2027-03-01'))).toEqual(new Date('2027-03-01'));
  });
});
