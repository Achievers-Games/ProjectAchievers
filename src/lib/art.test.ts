import { describe, expect, it } from 'vitest';
import { cssArt, gameArt } from './art';

describe('images de jeu en fond', () => {
  it('passe par la grande image Steam, l’en-tête en secours', () => {
    expect(gameArt('https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg')).toEqual(
      [
        'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_hero.jpg',
        'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg',
      ],
    );
  });

  it('retrouve la grande image d’un jeu récent à l’en-tête à empreinte', () => {
    const header =
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2358720/abc123/header.jpg?t=1700000000';
    expect(gameArt(header)).toEqual([
      'https://cdn.cloudflare.steamstatic.com/steam/apps/2358720/library_hero.jpg',
      header,
    ]);
  });

  it('garde telle quelle l’image d’une autre plateforme', () => {
    const icon = 'https://image.api.playstation.com/trophy/np/icon.png';
    expect(gameArt(icon)).toEqual([icon]);
    expect(cssArt([icon, 'https://x.test/a b.jpg'])).toBe(
      `url("${icon}"), url("https://x.test/a%20b.jpg")`,
    );
  });
});
