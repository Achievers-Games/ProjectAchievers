/** « system » suit le réglage clair ou sombre de la machine, même s'il change en cours de route. */
export const THEMES = ['dark', 'light', 'system'] as const;
type Theme = (typeof THEMES)[number];

/** Le thème enregistré dans le cookie ; sombre tant que rien n'est choisi. */
export const themeOf = (value: unknown): Theme =>
  THEMES.includes(value as Theme) ? (value as Theme) : 'dark';
