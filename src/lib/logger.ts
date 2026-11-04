type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Aussi partagé avec le navigateur (`$lib/push`), où `process` n'existe pas.
const configured =
  typeof process === 'undefined' ? undefined : (process.env.LOG_LEVEL as Level | undefined);
const minimum = ORDER[configured ?? 'info'] ?? ORDER.info;

const output = {
  debug: (...message: unknown[]) => console.debug(...message),
  info: (...message: unknown[]) => console.info(...message),
  warn: (...message: unknown[]) => console.warn(...message),
  error: (...message: unknown[]) => console.error(...message),
};

/**
 * Un journal lisible en production : le niveau puis le domaine, avant ce que l'appelant a passé.
 * `LOG_LEVEL` (debug, info, warn, error) filtre les lignes les plus bavardes.
 */
export function logger(scope: string) {
  const write =
    (level: Level) =>
    (...message: unknown[]) => {
      if (ORDER[level] >= minimum) output[level](`[${level}] ${scope} :`, ...message);
    };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
