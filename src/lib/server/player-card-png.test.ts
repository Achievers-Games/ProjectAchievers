import { describe, expect, it, vi } from 'vitest';
import {
  renderPlayerCard,
  renderShareImage,
  CARD_WIDTH,
  CARD_HEIGHT,
  SHARE_WIDTH,
  SHARE_HEIGHT,
} from './player-card';
import { svgToPng } from './player-card-png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('carte de joueur en PNG', () => {
  it('rend une image PNG au double de la taille de la carte', async () => {
    const svg = renderPlayerCard({
      displayName: 'Ada',
      handle: 'ada',
      clan: 'Les Lève-tôt',
      games: 12,
      unlocked: 340,
      cards: 3,
      points: 90,
      avatar: null,
    });
    const png = await svgToPng(svg, CARD_WIDTH);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const view = new DataView(png.buffer, png.byteOffset);
    // L'en-tête IHDR porte la largeur et la hauteur juste après la signature.
    expect(view.getUint32(16)).toBe(CARD_WIDTH * 2);
    expect(view.getUint32(20)).toBe(CARD_HEIGHT * 2);
  });
});

describe('module rechargé', () => {
  it('rend encore une image depuis une copie neuve du module', async () => {
    const svg = renderPlayerCard({
      displayName: 'Ada',
      handle: 'ada',
      clan: null,
      games: 1,
      unlocked: 1,
      cards: 0,
      points: 0,
      avatar: null,
    });
    await svgToPng(svg, CARD_WIDTH);
    // Comme après un rechargement de Vite : une copie neuve du module.
    vi.resetModules();
    const fresh = await import('./player-card-png');
    const png = await fresh.svgToPng(svg, CARD_WIDTH);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});

describe('rendu hors du thread principal', () => {
  it('laisse le serveur répondre pendant qu’une grande carte se dessine', async () => {
    const svg = renderPlayerCard({
      displayName: 'Ada',
      handle: 'ada',
      clan: null,
      games: 1,
      unlocked: 1,
      cards: 0,
      points: 0,
      avatar: null,
    });
    // Polices et thread prêts : seul le dessin reste à mesurer.
    await svgToPng(svg, CARD_WIDTH);
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 5);
    const started = performance.now();
    // Une carte à l'échelle 8 : assez lente pour que le thread principal ait des tours à faire.
    await svgToPng(svg, CARD_WIDTH, 8);
    const elapsed = performance.now() - started;
    clearInterval(timer);
    // Un rendu synchrone ne laisserait passer aucun tour pendant tout le dessin.
    expect(ticks).toBeGreaterThan(Math.floor(elapsed / 5 / 4));
  });
});

describe('image de partage', () => {
  it('rend un PNG au format 1200 × 630 attendu par les réseaux', async () => {
    const svg = renderShareImage({
      displayName: '<Ada & "Bob">',
      handle: 'ada',
      clan: null,
      games: 12,
      unlocked: 340,
      cards: 3,
      points: 90,
      avatar: null,
    });
    expect(svg).not.toContain('<Ada');
    const png = await svgToPng(svg, SHARE_WIDTH, 1);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(SHARE_WIDTH);
    expect(view.getUint32(20)).toBe(SHARE_HEIGHT);
  });
});
