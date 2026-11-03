/**
 * Ouvre un flux d'événements et ne transmet que les messages JSON valides.
 * Une trame abîmée ne doit jamais arrêter le flux : elle est simplement ignorée.
 */
export function subscribeJson<T>(
  url: string,
  onEvent: (event: T) => void,
  onOpen?: () => void,
): () => void {
  const source = new EventSource(url);
  if (onOpen) source.onopen = onOpen;
  source.onmessage = (message) => {
    let event: T;
    try {
      event = JSON.parse(message.data) as T;
    } catch {
      return;
    }
    onEvent(event);
  };
  return () => source.close();
}
