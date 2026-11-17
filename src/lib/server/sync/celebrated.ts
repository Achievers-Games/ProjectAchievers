/** Quelques succès à la fois : le rattrapage en envoie trois, une synchronisation un peu plus. */
const MAX_IDS = 50;
const MAX_ID_LENGTH = 64;

/** Les identifiants envoyés par la page, ou `null` s'ils ne ressemblent à rien d'attendu. */
export function parseCelebratedIds(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_IDS) return null;
  const ok = parsed.every(
    (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH,
  );
  return ok ? (parsed as string[]) : null;
}
