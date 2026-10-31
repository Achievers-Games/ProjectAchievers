import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

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
  ],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // Les tests d'intégration partagent la même base.
    fileParallelism: false,
    env: {
      DATABASE_URL: database.href,
      ENCRYPTION_KEY: 'a'.repeat(64),
      ORIGIN: 'http://localhost:5173',
      STEAM_API_KEY: 'test-key',
    },
  },
});
