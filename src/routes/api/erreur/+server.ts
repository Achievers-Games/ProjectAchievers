import { z } from 'zod';
import { logger } from '#lib/logger';
import { readSmallBody } from '#lib/server/body';
import type { RequestHandler } from './$types';

const log = logger('Navigateur');

/** Un rapport tient largement là-dedans ; au-delà, ce n'est pas une erreur du site. */
const MAX_BODY = 4_000;

const schema = z.object({
  message: z.string().min(1).max(300),
  stack: z.string().max(1600).optional(),
  context: z.string().max(200).optional(),
});

/** Reçoit les erreurs remontées par le navigateur et les écrit dans le journal du serveur. */
export const POST: RequestHandler = async ({ request }) => {
  const body = await readSmallBody(request, MAX_BODY);
  if (body === null) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return new Response(null, { status: 400 });

  const { message, stack, context } = parsed.data;
  // Un saut de ligne dans le message permettrait de forger de fausses lignes de journal.
  const line = (text: string) => text.replace(/[\r\n]+/g, ' ');
  // La pile garde ses lignes, mais chacune est indentée : aucune ne peut se faire passer pour une
  // ligne du journal (`[error] Synchronisation : …`).
  const indented = stack?.replace(/\r\n?/g, '\n').replace(/^/gm, '    ');
  log.error(`${line(context ?? 'page')} : ${line(message)}`, indented ? `\n${indented}` : '');
  return new Response(null, { status: 204 });
};
