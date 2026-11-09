import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { reportClientError } from '#lib/report';

/** Les erreurs attrapées par SvelteKit (chargement, rendu) partent au journal du serveur. */
export const handleError: HandleClientError = (caught) => {
  // Depuis SvelteKit 3, les erreurs prévues (une page 404, un `error(403)`) passent aussi ici :
  // seules les pannes méritent le journal.
  if (caught.kind !== 'unknown') return;
  reportClientError(caught.error, caught.event.url.pathname);
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
