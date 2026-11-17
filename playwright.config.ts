import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:5174';
const database = new URL(
  process.env.DATABASE_URL ?? 'postgresql://achievers:achievers@localhost:5433/achievers',
);
database.pathname = '/achievers_test';

export default defineConfig({
  testDir: './e2e',
  // Tous les tests partagent la même base seedée : en parallèle, ils se marcheraient dessus.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    locale: 'fr-FR',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: database.href,
      VAPID_PUBLIC_KEY: 'cle-de-test',
      RETRO_API_KEY: 'cle-de-test',
      ORIGIN: baseURL,
      DEV_LOGIN: '1',
      // Le .env local porte le vrai SMTP : sans cette ligne, chaque test du formulaire de retour
      // ou de contact envoyait un vrai mail. Une variable déjà définie, même vide, n'est pas
      // remplacée par dotenv : le site se comporte comme sans SMTP, comme sur la CI.
      SMTP_HOST: '',
      CLOUDFLARE_ACCOUNT_ID: 'compte',
      CLOUDFLARE_AI_TOKEN: 'jeton',
      VITE_CACHE_DIR: 'node_modules/.vite-test',
    },
  },
});
