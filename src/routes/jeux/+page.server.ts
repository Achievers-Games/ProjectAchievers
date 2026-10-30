import { z } from 'zod';
import { listGames, PAGE_SIZE } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const query = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  plateforme: z.enum(['STEAM', 'PSN', 'XBOX']).optional().catch(undefined),
  tri: z.enum(['nom', 'recent', 'progression', 'succes']).catch('nom'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  vue: z.enum(['grille', 'liste']).catch('grille'),
  miens: z.literal('1').optional().catch(undefined),
});

export const load: PageServerLoad = async ({ url, locals }) => {
  const params = query.parse(Object.fromEntries(url.searchParams));
  const mine = Boolean(params.miens && locals.user);

  const { games, total } = await listGames(
    {
      q: params.q || undefined,
      platform: params.plateforme,
      sort: params.tri === 'progression' && !mine ? 'nom' : params.tri,
      page: params.page,
      ownerId: mine ? locals.user?.id : undefined,
    },
    locals.user?.id ?? null,
  );

  return { games, total, params: { ...params, mine }, pages: Math.ceil(total / PAGE_SIZE) };
};
