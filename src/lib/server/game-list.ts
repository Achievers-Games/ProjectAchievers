import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { m } from '$lib/paraglide/messages';
import { db } from './db';
import { listGames, PAGE_SIZE } from './queries';

export const TIER_FILTERS = ['bronze', 'argent', 'or', 'diamant', 'prismatique', 'legendaire'];

const query = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  joueur: z.string().trim().max(24).optional().catch(undefined),
  plateforme: z.enum(['STEAM', 'PSN', 'XBOX', 'RETRO', 'BLIZZARD']).optional().catch(undefined),
  tri: z.enum(['nom', 'recent', 'progression', 'succes']).catch('nom'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  vue: z.enum(['grille', 'liste']).catch('grille'),
  // « platine » était l'ancien nom du niveau : les liens déjà partagés restent valables.
  filtre: z
    .preprocess(
      (value) => (value === 'platine' ? 'diamant' : value),
      z.enum([
        'restants',
        'saison',
        'caches',
        'bronze',
        'argent',
        'or',
        'diamant',
        'prismatique',
        'legendaire',
      ]),
    )
    .optional()
    .catch(undefined),
});

/** Lecture commune à la page Jeux et au chargement au défilement. */
export async function gamesFromUrl(url: URL, user: App.Locals['user']) {
  const params = query.parse(Object.fromEntries(url.searchParams));
  // Un membre voit ses jeux ; le catalogue complet reste pour les visiteurs.
  const player = params.joueur
    ? await db.user.findFirst({
        where: { handle: params.joueur, OR: [{ isPublic: true }, { id: user?.id ?? '' }] },
        select: { id: true, handle: true, displayName: true },
      })
    : null;
  if (params.joueur && !player) error(404, m.profile_not_found());

  const ownerId = player?.id ?? user?.id;
  const own = ownerId === user?.id;
  const mine = Boolean(ownerId);
  const unfinished = mine && params.filtre === 'restants';
  // La progression n'existe que pour les jeux du joueur.
  const tri = params.tri === 'progression' && !mine ? 'nom' : params.tri;

  const { games, total } = await listGames(
    {
      q: params.q || undefined,
      platform: params.plateforme,
      sort: tri,
      page: params.page,
      ownerId,
      unfinished,
      seasonOnly: own && mine && params.filtre === 'saison',
      tier: mine ? TIER_FILTERS.indexOf(params.filtre ?? '') + 1 || undefined : undefined,
      // Les jeux cachés ne regardent que leur propriétaire.
      hidden: own && mine && params.filtre === 'caches',
      showAdult: user?.showAdult,
    },
    user?.id ?? null,
  );

  return {
    games,
    total,
    params: { ...params, tri, mine, filtre: mine ? params.filtre : undefined },
    player: own ? null : player,
    pages: Math.ceil(total / PAGE_SIZE),
  };
}
