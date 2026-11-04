import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const database = new URL(process.env.DATABASE_URL ?? '');
database.pathname = '/achievers_test';

export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
      cookieName: 'pa_lang',
    }),
    // Les composants se montent dans happy-dom : le plugin les compile comme dans l'application.
    svelte({ hot: false }),
  ],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
    },
    // Sans la condition navigateur, Svelte charge sa version serveur, où `mount` n'existe pas :
    // les tests de composants ne pourraient pas monter la moindre carte.
    conditions: ['browser'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // Les tests d'intégration partagent la même base.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // Les routes ne sont parcourues que par Playwright : les compter ici ferait baisser la
      // mesure sans rien dire. Ce rapport ne juge donc que le code que les tests unitaires atteignent.
      include: ['src/lib/**/*.{ts,svelte}'],
      // Le code généré et les bancs d'essai ne disent rien de la couverture du site.
      exclude: ['src/lib/paraglide/**', 'src/**/*.test.ts', 'src/lib/server/test-helpers.ts'],
      reporter: ['text-summary', 'text', 'json-summary'],
    },
    env: {
      DATABASE_URL: database.href,
      ENCRYPTION_KEY: 'a'.repeat(64),
      ORIGIN: 'http://localhost:5173',
      STEAM_API_KEY: 'test-key',
      DISCORD_BOT_TOKEN: 'bot',
      CLOUDFLARE_ACCOUNT_ID: 'compte',
      CLOUDFLARE_AI_TOKEN: 'jeton',
    },
  },
});
