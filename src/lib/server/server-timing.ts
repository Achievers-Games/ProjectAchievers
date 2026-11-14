/**
 * Les mesures d'un chargement de page, rendues dans l'en-tête `Server-Timing` : l'onglet réseau
 * du navigateur montre où part le temps, sans rien ouvrir sur le NAS.
 */
export function serverTiming() {
  const entries: string[] = [];
  let lap = performance.now();
  const record = (metric: string, duration: number) => {
    entries.push(`${metric};dur=${Math.round(duration)}`);
  };
  return {
    record,
    /** Le temps écoulé depuis la marque précédente (ou la création). */
    mark(metric: string) {
      const now = performance.now();
      record(metric, now - lap);
      lap = now;
    },
    /** Le temps d'une étape qui tourne en parallèle des autres. */
    async time<T>(metric: string, task: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        return await task();
      } finally {
        record(metric, performance.now() - started);
      }
    },
    headers: () => ({ 'Server-Timing': entries.join(', ') }),
  };
}
