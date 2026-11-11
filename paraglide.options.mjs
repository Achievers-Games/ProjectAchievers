// Les réglages de Paraglide, partagés par le site (vite.config.ts), les tests (vitest.config.ts)
// et la vérification des types (scripts/paraglide.mjs) : tous génèrent le même runtime.

/** Les langues du site, comme dans project.inlang : la première est la langue de base. */
const LOCALES = ['fr', 'en', 'es', 'de', 'pt-BR', 'ru', 'zh-CN', 'ja'];

/** @type {import('@inlang/paraglide-js').CompilerOptions} */
export const paraglideOptions = {
  project: './project.inlang',
  outdir: './src/lib/paraglide',
  strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
  cookieName: 'pa_lang',
  // Une adresse par langue pour les moteurs : /fr/…, /en/…, /de/… Sous ce préfixe, l'adresse
  // décide de la langue, pour tout le monde. Sans préfixe, l'adresse d'avant reste valable et
  // suit le choix du visiteur (cookie, puis langue du navigateur) : c'est la version x-default.
  urlPatterns: [
    {
      pattern: ':protocol://:domain(.*)::port?/:path(.*)?',
      localized: LOCALES.map((locale) => [
        locale,
        `:protocol://:domain(.*)::port?/${locale}/:path(.*)?`,
      ]),
    },
  ],
  // Comme SvelteKit, qui redirige /en/ vers /en : une adresse canonique ne doit pas rediriger.
  trailingSlash: 'never',
  routeStrategies: [{ match: `/:locale(${LOCALES.join('|')}){/:path(.*)}?`, strategy: ['url'] }],
};
