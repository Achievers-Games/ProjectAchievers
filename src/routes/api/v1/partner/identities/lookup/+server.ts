import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { Provider } from '#prisma';
import { apiError, partnerRoute } from '#lib/server/partner-api';
import { findUsersByIdentities } from '#lib/server/partner-link';
import type { RequestHandler } from './$types';

const PROVIDERS = [
  'STEAM',
  'DISCORD',
  'PSN',
  'XBOX',
  'GOOGLE',
  'RETRO',
  'EPIC',
  'BLIZZARD',
] as const satisfies readonly Provider[];

const schema = z.object({
  identities: z
    .array(
      z.object({
        provider: z.enum(PROVIDERS),
        providerUserId: z.string().trim().min(1).max(128),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * Les comptes Achievers qui ont vérifié ces identités auprès du fournisseur.
 *
 * Le partenaire n'envoie que des identifiants qu'il a lui-même vérifiés (OAuth, OpenID) : c'est
 * ce qui rend la liaison sûre, sans qu'aucun des deux sites n'ait à croire l'autre sur parole.
 * La réponse se limite à des identifiants de comptes, sans nom ni donnée de profil.
 */
export const POST: RequestHandler = partnerRoute(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'bad_request', 'Body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'bad_request',
      'identities must hold 1 to 20 verified {provider, providerUserId} entries.',
    );
  }

  const partnerUserIds = await findUsersByIdentities(parsed.data.identities);
  return json({ partnerUserIds }, { headers: { 'Cache-Control': 'no-store' } });
});
