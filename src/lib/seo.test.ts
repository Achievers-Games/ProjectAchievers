import { describe, expect, it } from 'vitest';
import { excerpt } from './seo';

describe('excerpt', () => {
  it('retire la mise en forme Markdown', () => {
    expect(
      excerpt('## Étape 1\n\n- [ ] Ouvre la **porte** du [donjon](https://x.y)\n\n![carte](a.png)'),
    ).toBe('Étape 1 Ouvre la porte du donjon');
  });

  it('coupe au dernier mot entier', () => {
    const text = excerpt('mot '.repeat(100), 20);
    expect(text.length).toBeLessThanOrEqual(20);
    expect(text).toBe('mot mot mot mot…');
  });
});
