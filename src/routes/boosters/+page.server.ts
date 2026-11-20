import { error, fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { bannerProgress } from '#lib/server/card-banner';
import { db } from '#lib/server/db';
import {
  BoosterError,
  cardClues,
  editionAssets,
  boosterState,
  familyArt,
  openBooster,
  recentOpenings,
  type BoosterCard,
} from '#lib/server/boosters';
import { rateLimit } from '#lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const requireUser = (locals: App.Locals) => requireLogin(locals, '/boosters');

/** Au-delà, un script ouvre des boosters à la chaîne : l'animation seule en prend plusieurs secondes. */
const OPENINGS_PER_MINUTE = 12;

/**
 * Ajoute à chaque carte le nom et l'image de son jeu, le dossier de sa carte animée, et les
 * indices qui font monter la tension avant de retourner une carte rare.
 */
async function withArt(userId: string, cards: BoosterCard[]) {
  const rare = cards.filter((card) => card.kind !== 'RELIEF').map((card) => card.familyKey);
  const families = cards.map((card) => card.familyKey);
  const [art, assets, clues, progress] = await Promise.all([
    familyArt(families),
    editionAssets(cards.map((card) => card.editionId)),
    cardClues(rare),
    bannerProgress(userId, families),
  ]);
  return cards.map((card) => ({
    ...card,
    game: art.get(card.familyKey) ?? null,
    assetPath: assets.get(card.editionId) ?? null,
    bannerCompletion: progress.get(card.familyKey) ?? null,
    clues: card.kind === 'RELIEF' ? null : (clues.get(card.familyKey) ?? null),
  }));
}

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:sync');
  const user = requireUser(locals);
  const [state, openings, profile] = await Promise.all([
    boosterState(user.id),
    recentOpenings(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { bannerEditionId: true } }),
  ]);
  const art = await familyArt(openings.flatMap((opening) => opening.cards.map((c) => c.familyKey)));
  return {
    state,
    bannerEditionId: profile.bannerEditionId,
    history: openings.map((opening) => ({
      id: opening.id,
      kind: opening.kind,
      createdAt: opening.createdAt,
      cards: opening.cards.map((card) => ({ ...card, game: art.get(card.familyKey) ?? null })),
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
