/** Envoie du JSON au site ; renvoie la réponse, ou null si le réseau a échoué. */
export const sendJson = (url: string, body: unknown, method = 'POST') =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
