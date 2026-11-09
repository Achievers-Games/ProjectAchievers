import { describe, expect, it } from 'vitest';
import { headingId, partnerGuide } from './partner-guide';

describe('guide des partenaires', () => {
  it('donne à chaque lien du sommaire un titre où atterrir', () => {
    const { title, html } = partnerGuide();
    expect(title).toBe('API partenaires Achievers');
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => decodeURI(match[1]!));
    expect(anchors.length).toBeGreaterThanOrEqual(7);
    for (const anchor of anchors) expect(ids, anchor).toContain(anchor);
  });

  it('ancre les titres comme le sommaire', () => {
    expect(headingId('5. « Se connecter avec Achievers » (OAuth 2)')).toBe(
      '5-se-connecter-avec-achievers-oauth-2',
    );
  });

  it('ne cite plus de vrai compte en exemple', () => {
    expect(partnerGuide().html).not.toMatch(/kokki|lureverse|56ea6c14/);
  });
});
