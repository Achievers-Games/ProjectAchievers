import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Les tests ont leur propre cache : deux serveurs ne doivent jamais en partager un.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { port: 5173, strictPort: true },
  // Préchargés au démarrage : sinon Vite recharge la page au premier import, en plein parcours.
  optimizeDeps: {
    include: [
      '@lucide/svelte',
      '@fortawesome/free-brands-svg-icons',
      'simple-icons',
      'svelte/animate',
      'svelte/transition',
    ],
  },
});
