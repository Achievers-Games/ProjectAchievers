import { describe, expect, it, vi } from 'vitest';
import { inlineAvatar, renderPlayerCard, type PlayerCardData } from './player-card';

const base: PlayerCardData = {
  displayName: 'Ada',
  handle: 'ada',
  clan: null,
  games: 1234,
  unlocked: 42,
  cards: 3,
  points: 90,
  avatar: null,
};

describe('carte de joueur', () => {
  it('échappe tout ce que le joueur a écrit', () => {
    const svg = renderPlayerCard({ ...base, displayName: '<script>"&', clan: "L'<b>" });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;script&gt;&quot;&amp;');
    expect(svg).toContain('L&apos;&lt;b&gt;');
  });

  it("montre l'initiale sans avatar, et l'image intégrée sinon", () => {
    expect(renderPlayerCard(base)).toContain('>A</text>');
    const svg = renderPlayerCard({ ...base, avatar: 'data:image/png;base64,AAAA' });
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
  });

  it('raccourcit les noms trop longs', () => {
    const svg = renderPlayerCard({ ...base, displayName: 'x'.repeat(40) });
    expect(svg).toContain(`${'x'.repeat(23)}…`);
  });

  it('va chercher en https un avatar donné en http, comme ceux de PSN', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    });
    const data = await inlineAvatar('http://static-resource.np.community.playstation.net/a.png');
    expect(fetched).toEqual(['https://static-resource.np.community.playstation.net/a.png']);
    expect(data).toBe('data:image/png;base64,AQID');
    expect(await inlineAvatar('ftp://exemple/a.png')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('reste un document SVG autonome', () => {
    const svg = renderPlayerCard(base);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/href="https?:/);
  });
});
