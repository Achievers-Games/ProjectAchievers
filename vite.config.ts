import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
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
