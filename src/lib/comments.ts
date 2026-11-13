/** Une discussion s'ouvre sur ses cent premiers commentaires ; « Afficher plus » en ajoute cent. */
export const COMMENTS_STEP = 100;
const COMMENTS_MAX = 2_000;
export const COMMENTS_PARAM = 'commentaires';

/** Le nombre de commentaires demandé dans l'adresse, toujours un multiple du pas et plafonné. */
export function commentLimit(url: { searchParams: Pick<URLSearchParams, 'get'> }): number {
  const asked = Number(url.searchParams.get(COMMENTS_PARAM));
  if (!Number.isFinite(asked) || asked <= COMMENTS_STEP) return COMMENTS_STEP;
  return Math.min(Math.ceil(asked / COMMENTS_STEP) * COMMENTS_STEP, COMMENTS_MAX);
}
