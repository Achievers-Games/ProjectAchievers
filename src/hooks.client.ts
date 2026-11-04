import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { reportClientError } from '#lib/report';

/** Les erreurs attrapées par SvelteKit (chargement, rendu) partent au journal du serveur. */
export const handleError: HandleClientError = ({ error, event }) => {
  reportClientError(error, event.url.pathname);
};

export const init: ClientInit = () => {
  // Ce que Svelte n'attrape pas : écouteurs d'événements, promesses sans gestionnaire, code natif.
  window.addEventListener('error', (event) =>
    reportClientError(event.error ?? event.message, 'window.error'),
  );
  window.addEventListener('unhandledrejection', (event) =>
    reportClientError(event.reason, 'unhandledrejection'),
  );
};
