import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { paraglideOptions } from './paraglide.options.mjs';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const database = new URL(process.env.DATABASE_URL ?? '');
database.pathname = '/achievers_test';

export default defineConfig({
  plugins: [
    // Les mêmes réglages que le site : les adresses par langue se testent comme en production.
    paraglideVitePlugin(paraglideOptions),
    // Les composants se montent dans happy-dom : le plugin les compile comme dans l'application.
    svelte({ preprocess: vitePreprocess() }),
  ],
  resolve: {
    alias: {
      '#lib': path.resolve(import.meta.dirname, './src/lib'),
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
      // Jamais de vrai mail depuis un test, même avec le SMTP du .env local.
      SMTP_HOST: '',
    },
  },
});
