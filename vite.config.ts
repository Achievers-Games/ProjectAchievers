import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
      cookieName: 'pa_lang',
    }),
    sveltekit(),
  ],
  // Les tests ont leur propre cache : deux serveurs ne doivent jamais en partager un.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { port: 5173, strictPort: true },
  // Préchargés au démarrage : sinon Vite recharge la page au premier import, en plein parcours.
  optimizeDeps: {
    include: [
      '@lucide/svelte/icons/chevron-down',
      '@lucide/svelte/icons/chevron-left',
      '@lucide/svelte/icons/chevron-right',
      '@lucide/svelte/icons/chevron-up',
      '@lucide/svelte/icons/compass',
      '@lucide/svelte/icons/crown',
      '@lucide/svelte/icons/eye',
      '@lucide/svelte/icons/eye-off',
      '@lucide/svelte/icons/flag',
      '@lucide/svelte/icons/gamepad-2',
      '@lucide/svelte/icons/gem',
      '@lucide/svelte/icons/languages',
      '@lucide/svelte/icons/layout-grid',
      '@lucide/svelte/icons/link',
      '@lucide/svelte/icons/list',
      '@lucide/svelte/icons/lock',
      '@lucide/svelte/icons/search',
      '@lucide/svelte/icons/sparkles',
      '@lucide/svelte/icons/star',
      '@lucide/svelte/icons/trophy',
      '@lucide/svelte/icons/user',
      '@fortawesome/free-brands-svg-icons',
      'simple-icons',
      'svelte/animate',
      'svelte/transition',
    ],
  },
});
