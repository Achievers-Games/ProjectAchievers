import { formatNumber } from '$lib/labels';
import { m } from '$lib/paraglide/messages';

export interface TaglineStats {
  games: number;
  finished: number;
  /** Avancement du jeu le plus proche de la fin. */
  closest: number | null;
}

const GENERAL = [m.tagline_1, m.tagline_4, m.tagline_6, m.tagline_7, m.tagline_8, m.tagline_9];

/** Les phrases chiffrées parlent du joueur : un invité n'en voit aucune. */
function personal({ games, finished, closest }: TaglineStats) {
  const percent = closest === null ? null : Math.round(closest);
  return [
    ...(games >= 2
      ? [
          () =>
            m.tagline_3({
              games: formatNumber(games),
              finished: formatNumber(finished),
            }),
        ]
      : []),
    ...(percent === null ? [] : [() => m.tagline_2({ percent }), () => m.tagline_5({ percent })]),
  ];
}

/** Tirée côté serveur : le navigateur doit afficher la même phrase que la page reçue. */
export function randomTagline(stats?: TaglineStats) {
  const taglines = [...GENERAL, ...(stats ? personal(stats) : [])];
  return (taglines[Math.floor(Math.random() * taglines.length)] ?? m.tagline_1)();
}
