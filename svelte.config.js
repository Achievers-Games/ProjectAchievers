// SvelteKit config — architecture Kyara.games :
// rendu statique pour Tauri (fallback SPA), polices et tokens dans app.html.
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    alias: {
      '@': 'src',
    },
    adapter: adapter({
      pages: 'dist',
      assets: 'dist',
      fallback: 'index.html', // mode SPA : Tauri charge dist/index.html
      precompress: false,
      strict: false,
    }),
  },
};

export default config;
