import { m } from '$lib/paraglide/messages';

const TAGLINES = [
  m.tagline_1,
  m.tagline_2,
  m.tagline_3,
  m.tagline_4,
  m.tagline_5,
  m.tagline_6,
  m.tagline_7,
  m.tagline_8,
  m.tagline_9,
];

/** Tirée côté serveur : le navigateur doit afficher la même phrase que la page reçue. */
export const randomTagline = () => Math.floor(Math.random() * TAGLINES.length);

export const taglineText = (index: number) => (TAGLINES[index] ?? m.tagline_1)();
