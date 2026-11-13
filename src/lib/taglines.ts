import { formatNumber } from '#lib/labels';
import { m } from '#lib/paraglide/messages';

interface TaglineStats {
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

interface Tagline {
  text: () => string;
  /** La phrase parle de ce jeu à peine lancé : la bannière doit le montrer. */
  barelyPlayed?: boolean;
}

/** Les phrases chiffrées parlent du joueur : un invité n'en voit aucune. */
function personal({ games, finished, closest, closestName, barelyPlayed }: TaglineStats) {
  const percent = closest === null ? null : Math.round(closest);
  const taglines: Tagline[] = [];
  if (games >= 2) {
    taglines.push({
      text: () => m.tagline_3({ games: formatNumber(games), finished: formatNumber(finished) }),
    });
  }
  if (percent !== null) {
    taglines.push(
      { text: () => m.tagline_2({ percent }) },
      { text: () => m.tagline_5({ percent }) },
    );
    if (closestName) {
      taglines.push({ text: () => m.tagline_16({ game: closestName, percent }) });
    }
  }
  if (barelyPlayed) {
    taglines.push({
      barelyPlayed: true,
      text: () =>
        m.tagline_20({
          game: barelyPlayed.name,
          minutes: formatNumber(barelyPlayed.minutes),
        }),
    });
  }
  return taglines;
}

/** Tirée côté serveur : le navigateur doit afficher la même phrase que la page reçue. */
export function randomTagline(stats?: TaglineStats) {
  const taglines: Tagline[] = [
    ...GENERAL.map((text) => ({ text })),
    ...(stats ? personal(stats) : []),
  ];
  const picked = taglines[Math.floor(Math.random() * taglines.length)];
  return {
    text: (picked?.text ?? m.tagline_1)(),
    barelyPlayed: picked?.barelyPlayed ?? false,
  };
}
