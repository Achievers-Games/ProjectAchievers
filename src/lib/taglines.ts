import { formatNumber } from '$lib/labels';
import { m } from '$lib/paraglide/messages';

export interface TaglineStats {
  games: number;
  finished: number;
  /** Avancement du jeu le plus proche de la fin. */
  closest: number | null;
  closestName: string | null;
  /** Jeu à peine lancé : Steam donne le temps de jeu, pas le nombre de lancements. */
  barelyPlayed: { name: string; minutes: number } | null;
}

const GENERAL = [
  m.tagline_1,
  m.tagline_4,
  m.tagline_6,
  m.tagline_7,
  m.tagline_8,
  m.tagline_9,
  m.tagline_10,
  m.tagline_11,
  m.tagline_12,
  m.tagline_13,
  m.tagline_14,
  m.tagline_15,
  m.tagline_17,
  m.tagline_18,
  m.tagline_19,
];

/** Les phrases chiffrées parlent du joueur : un invité n'en voit aucune. */
function personal({ games, finished, closest, closestName, barelyPlayed }: TaglineStats) {
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
    ...(percent === null || !closestName
      ? []
      : [() => m.tagline_16({ game: closestName, percent })]),
    ...(barelyPlayed
      ? [
          () =>
            m.tagline_20({
              game: barelyPlayed.name,
              minutes: formatNumber(barelyPlayed.minutes),
            }),
        ]
      : []),
  ];
}

/** Tirée côté serveur : le navigateur doit afficher la même phrase que la page reçue. */
export function randomTagline(stats?: TaglineStats) {
  const taglines = [...GENERAL, ...(stats ? personal(stats) : [])];
  return (taglines[Math.floor(Math.random() * taglines.length)] ?? m.tagline_1)();
}
