const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

/**
 * Steam a une grande image (1920 × 620) pour la plupart des jeux ; l'en-tête (460 × 215) prend
 * le relais sinon. Les jeux récents ont une adresse d'en-tête à empreinte, sans grande image à
 * côté : le numéro du jeu retrouve celle de l'adresse classique.
 */
export const gameArt = (headerUrl: string) => {
  const steam = /steamstatic\.com\/.*\/apps\/(\d+)\//.exec(headerUrl);
  if (steam) {
    const hero = `${STEAM_CDN}/${steam[1]}/library_hero.jpg`;
    return hero === headerUrl ? [hero] : [hero, headerUrl];
  }
  return headerUrl.endsWith('/header.jpg')
    ? [headerUrl.replace('/header.jpg', '/library_hero.jpg'), headerUrl]
    : [headerUrl];
};

/**
 * Les images en couches CSS, la première devant : si la grande image manque, celle de dessous
 * apparaît à sa place.
 */
export const cssArt = (images: string[]) =>
  images.map((image) => `url("${encodeURI(image)}")`).join(', ');

/** La même capture Steam en vignette (600 × 338), pour choisir sans tout télécharger. */
export const thumbArt = (artUrl: string) => artUrl.replace('.1920x1080.jpg', '.600x338.jpg');

/** En dessous, l'image ne couvre plus un écran sans se pixeliser : on la floute en ambiance. */
export const SHARP_WIDTH = 1200;
