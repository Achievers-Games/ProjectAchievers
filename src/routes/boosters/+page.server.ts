import { error, fail } from '@sveltejs/kit';
import { editionThumb } from '#lib/animated-card';
import { m } from '#lib/paraglide/messages';
import { requireCards } from '#lib/server/cards-launch';
import { withArt } from '#lib/server/booster-art';
import { db } from '#lib/server/db';
import {
  BoosterError,
  editionAssets,
  boosterState,
  familyArt,
  openBooster,
  recentOpenings,
} from '#lib/server/boosters';
import { rateLimit } from '#lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const requireUser = (locals: App.Locals) => requireCards(locals, '/boosters');

/** Au-delà, un script ouvre des boosters à la chaîne : l'animation seule en prend plusieurs secondes. */
const OPENINGS_PER_MINUTE = 12;

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:sync');
  const user = requireUser(locals);
  const [state, openings, profile] = await Promise.all([
    boosterState(user.id),
    recentOpenings(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { bannerEditionId: true } }),
  ]);
  const drawn = openings.flatMap((opening) => opening.cards);
  const [art, assets] = await Promise.all([
    familyArt(drawn.map((card) => card.familyKey)),
    editionAssets(drawn.map((card) => card.editionId)),
  ]);
  return {
    state,
    bannerEditionId: profile.bannerEditionId,
    history: openings.map((opening) => ({
      id: opening.id,
      kind: opening.kind,
      createdAt: opening.createdAt,
      // L'historique montre de petites vignettes : la miniature suffit.
      cards: opening.cards.map((card) => {
        const game = art.get(card.familyKey);
        return {
          ...card,
          game: game
            ? { ...game, headerUrl: editionThumb(assets.get(card.editionId), game.headerUrl) }
            : null,
        };
      }),
    })),
  };
};

const failures = {
  no_booster: () => m.boosters_no_booster(),
  no_shards: () => m.boosters_no_shards(),
  no_cards: () => m.boosters_no_cards(),
  playtime_hidden: () => m.boosters_playtime_hidden(),
};

export const actions: Actions = {
  open: async ({ request, locals }) => {
    const user = requireUser(locals);
    if (!rateLimit(`booster:${user.id}`, OPENINGS_PER_MINUTE, 60_000)) error(429, m.too_fast());
    const source = (await request.formData()).get('source') === 'daily' ? 'DAILY' : 'SHARDS';
    try {
      const opened = await openBooster(user.id, source);
      return { opened: { ...opened, cards: await withArt(user.id, opened.cards) } };
    } catch (cause) {
      if (cause instanceof BoosterError) return fail(400, { error: failures[cause.code]() });
      throw cause;
    }
  },
};
