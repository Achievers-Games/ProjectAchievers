import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Platform } from '#prisma';
import { m } from '#lib/paraglide/messages';
import { db } from './db';
import { listGames, PAGE_SIZE, type GameStatus } from './queries';

/** Les consoles se filtrent à part : chacune donne son propre exemplaire. */
const CONSOLES: Record<string, { platform: Platform; consoles: string[] }> = {
  PS3: { platform: 'PSN', consoles: ['PS3'] },
  PS4: { platform: 'PSN', consoles: ['PS4'] },
  PS5: { platform: 'PSN', consoles: ['PS5'] },
  VITA: { platform: 'PSN', consoles: ['Vita'] },
  X360: { platform: 'XBOX', consoles: ['360'] },
  XONE: { platform: 'XBOX', consoles: ['One', 'Series'] },
};

const TIER_FILTERS = ['bronze', 'argent', 'or', 'diamant', 'prismatique', 'legendaire'];

const query = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  joueur: z.string().trim().max(24).optional().catch(undefined),
  plateforme: z
    .enum([
      'STEAM',
      'PSN',
      'PS3',
      'PS4',
      'PS5',
      'VITA',
      'XBOX',
      'X360',
      'XONE',
      'RETRO',
      'BLIZZARD',
    ])
    .optional()
    .catch(undefined),
  // Sans tri choisi, les jeux à finir se rangent par avancée, les autres par nom.
  tri: z.enum(['nom', 'recent', 'progression', 'succes', 'rarete']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  vue: z.enum(['grille', 'liste']).catch('grille'),
  // « platine » était l'ancien nom du niveau : les liens déjà partagés restent valables.
  filtre: z
    .preprocess(
      (value) => (value === 'platine' ? 'diamant' : value),
      z.enum([
        'termines',
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
  // La rareté du jeu se combine avec tout le reste : « Non 100 % » et « Légendaire ».
  niveau: z
    .preprocess(
      (value) => (value === 'platine' ? 'diamant' : value),
      z.enum(['bronze', 'argent', 'or', 'diamant', 'prismatique', 'legendaire']),
    )
    .optional()
    .catch(undefined),
});

/** Lecture commune à la page Jeux et au chargement au défilement. */
export async function gamesFromUrl(url: URL, user: App.Locals['user']) {
  const parsed = query.parse(Object.fromEntries(url.searchParams));
  // Les anciens liens passaient le niveau dans « filtre ».
  const legacy = TIER_FILTERS.includes(parsed.filtre ?? '') ? parsed.filtre : undefined;
  const params = {
    ...parsed,
    filtre: legacy ? undefined : parsed.filtre,
    niveau: parsed.niveau ?? (legacy as typeof parsed.niveau),
  };
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
  // La saison et les jeux cachés ne regardent que leur propriétaire.
  const status: GameStatus | undefined =
    !mine || ((params.filtre === 'saison' || params.filtre === 'caches') && !own)
      ? undefined
      : (params.filtre as GameStatus | undefined);
  const ongoing = status === 'restants' || status === 'saison';
  // La progression n'existe que pour les jeux du joueur.
  const tri =
    params.tri === 'progression' && !mine
      ? 'nom'
      : (params.tri ?? (ongoing ? 'progression' : 'nom'));
  const chosen = params.plateforme ? CONSOLES[params.plateforme] : undefined;
  const platform = chosen?.platform ?? (params.plateforme as Platform | undefined);

  const { games, total } = await listGames(
    {
      q: params.q || undefined,
      platform,
      consoles: chosen?.consoles,
      sort: tri,
      page: params.page,
      ownerId,
      status,
      tier: TIER_FILTERS.indexOf(params.niveau ?? '') + 1 || undefined,
      showAdult: user?.showAdult,
    },
    user?.id ?? null,
  );

  return {
    games,
    total,
    params: {
      ...params,
      tri,
      mine,
      filtre: status,
    },
    player: own ? null : player,
    pages: Math.ceil(total / PAGE_SIZE),
  };
}
