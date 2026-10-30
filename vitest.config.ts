import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
      ENCRYPTION_KEY: 'a'.repeat(64),
      ORIGIN: 'http://localhost:5173',
      STEAM_API_KEY: 'test-key',
    },
  },
});
