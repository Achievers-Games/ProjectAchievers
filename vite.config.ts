import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed port and no TTY clearing during `tauri dev`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Don't watch the huge Rust target directory
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: 'dist',
    target: 'chrome110', // minimum supported by WebView2 / Tauri
    sourcemap: false,
  },
});
