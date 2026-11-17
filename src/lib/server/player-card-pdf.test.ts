import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, renderPlayerCard } from './player-card';
import { imagePdf, splitAlpha, svgToPdf } from './player-card-pdf';

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1');

describe('carte de joueur en PDF', () => {
  it('sépare la transparence et rend aux couleurs leur valeur pure', () => {
    const { rgb, alpha } = splitAlpha(new Uint8Array([100, 50, 0, 128, 10, 20, 30, 255]));
    expect([...rgb]).toEqual([199, 100, 0, 10, 20, 30]);
    expect([...alpha!]).toEqual([128, 255]);
  });

  it("se passe de masque quand l'image est opaque", () => {
    expect(splitAlpha(new Uint8Array([1, 2, 3, 255])).alpha).toBeNull();
  });

  it('indexe chaque objet à sa vraie position', () => {
    const pdf = imagePdf(
      { width: 1, height: 1, rgb: new Uint8Array([1, 2, 3]), alpha: new Uint8Array([9]) },
      { width: 600, height: 180 },
      'Carte de Zoë',
    );
    const source = text(pdf);
    const xref = Number(/startxref\n(\d+)/.exec(source)![1]);
    expect(source.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...source.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(7);
    offsets.forEach((offset, index) => {
      expect(source.startsWith(`${index + 1} 0 obj\n`, offset)).toBe(true);
    });
    expect(source).toContain('/MediaBox [0 0 600 180]');
    expect(source).toContain('/SMask 7 0 R');
  });

  it('embarque la carte rendue au quadruple, coins arrondis compris', async () => {
    const svg = renderPlayerCard({
      displayName: 'Ada',
      handle: 'ada',
      clan: null,
      games: 12,
      unlocked: 340,
      cards: 3,
      points: 90,
      avatar: null,
    });
    const pdf = await svgToPdf(svg, { width: CARD_WIDTH, height: CARD_HEIGHT }, 'Ada');
    const source = text(pdf);
    expect(source.startsWith('%PDF-1.4')).toBe(true);
    expect(source.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(source).toContain(`/Width ${CARD_WIDTH * 4} /Height ${CARD_HEIGHT * 4}`);

    const start = source.indexOf('stream\n', source.indexOf('/ColorSpace /DeviceRGB')) + 7;
    const end = source.indexOf('\nendstream', start);
    const rgb = inflateSync(Buffer.from(pdf.subarray(start, end)));
    expect(rgb.length).toBe(CARD_WIDTH * 4 * CARD_HEIGHT * 4 * 3);
  });
});
