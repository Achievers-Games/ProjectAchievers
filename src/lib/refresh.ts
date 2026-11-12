import { logger } from './logger';

/** Regroupe une rafale d'événements et ne lance jamais deux relectures en parallèle. */
export function batchRefresh(refresh: () => Promise<void>, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  let disposed = false;

  function schedule() {
    if (!disposed && !running && !timer) timer = setTimeout(() => void flush(), delay);
  }
  async function flush() {
    timer = undefined;
    dirty = false;
    running = true;
    try {
      await refresh();
    } catch (cause) {
      logger('Actualisation').warn(cause);
    } finally {
      running = false;
      if (dirty) schedule();
    }
  }
  return {
    request() {
      if (!disposed) {
        dirty = true;
        schedule();
      }
    },
    cancel() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
