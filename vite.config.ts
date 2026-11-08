import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-node';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
      cookieName: 'pa_lang',
    }),
    // Depuis SvelteKit 3, la configuration du kit vit ici : `svelte.config.js` n'est plus lu.
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter(),
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'https:'],
          'media-src': ['https:'],
          'frame-src': ['https://www.youtube-nocookie.com'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'frame-ancestors': ['none'],
          'base-uri': ['self'],
          'form-action': [
            'self',
            'https://steamcommunity.com',
            'https://discord.com',
            'https://login.microsoftonline.com',
            'https://accounts.google.com',
          ],
        },
      },
    }),
  ],
  // Les tests ont leur propre cache : deux serveurs ne doivent jamais en partager un.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { port: 3000, strictPort: true },
  // Préchargés au démarrage : sinon Vite recharge la page au premier import, en plein parcours.
  optimizeDeps: {
    include: [
      '@lucide/svelte/icons/check',
      '@lucide/svelte/icons/chevron-down',
      '@lucide/svelte/icons/chevron-left',
      '@lucide/svelte/icons/chevron-right',
      '@lucide/svelte/icons/chevron-up',
      '@lucide/svelte/icons/compass',
      '@lucide/svelte/icons/crown',
      '@lucide/svelte/icons/eye',
      '@lucide/svelte/icons/eye-off',
      '@lucide/svelte/icons/flag',
      '@lucide/svelte/icons/flame',
      '@lucide/svelte/icons/gamepad-2',
      '@lucide/svelte/icons/gem',
      '@lucide/svelte/icons/languages',
      '@lucide/svelte/icons/layout-grid',
      '@lucide/svelte/icons/link',
      '@lucide/svelte/icons/list',
      '@lucide/svelte/icons/lock',
      '@lucide/svelte/icons/message-circle',
      '@lucide/svelte/icons/refresh-cw',
      '@lucide/svelte/icons/search',
      '@lucide/svelte/icons/sparkles',
      '@lucide/svelte/icons/star',
      '@lucide/svelte/icons/trophy',
      '@lucide/svelte/icons/user',
      '@lucide/svelte/icons/x',
      '@fortawesome/free-brands-svg-icons',
      'simple-icons',
      'svelte/animate',
      'svelte/transition',
    ],
  },
});
