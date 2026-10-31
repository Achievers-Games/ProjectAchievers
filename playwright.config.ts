import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:5174';
const database = new URL(process.env.DATABASE_URL ?? '');
database.pathname = '/achievers_test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
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
      ORIGIN: baseURL,
      DEV_LOGIN: '1',
      VITE_CACHE_DIR: 'node_modules/.vite-test',
    },
  },
});
