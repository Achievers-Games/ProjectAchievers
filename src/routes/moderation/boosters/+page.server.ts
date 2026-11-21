import { fail } from '@sveltejs/kit';
import { MYTHIQUE_PITY } from '#lib/boosters';
import { m } from '#lib/paraglide/messages';
import { withArt } from '#lib/server/booster-art';
import { BoosterError, editionPool, simulateBoosters, trialBooster } from '#lib/server/boosters';
import { db } from '#lib/server/db';
import { requireModerator } from '#lib/server/moderator';
import { rateLimit } from '#lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

/** Une simulation ouvre au plus ce nombre de boosters : le calcul reste sous la seconde. */
const SIMULATION_MAX = 10_000;

export const load: PageServerLoad = async ({ locals }) => {
  requireModerator(locals);
  const pool = await editionPool(db);
  return {
    pool: {
      RELIEF: pool.RELIEF.length,
      VIVANTE: pool.VIVANTE.length,
      MYTHIQUE: pool.MYTHIQUE.length,
    },
  };
};

/** Un nombre entier du formulaire, ramené entre `min` et `max`. */
function bounded(value: FormDataEntryValue | null, min: number, max: number, fallback: number) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}

export const actions: Actions = {
  /** Ouvre un booster d'essai : rien n'est payé, rien n'est gardé. */
  open: async ({ locals, request }) => {
    const user = requireModerator(locals);
    if (!rateLimit(`trial-booster:${user.id}`, 60, 60_000))
      return fail(429, { error: m.too_fast() });
    const form = await request.formData();
    const kind = form.get('kind') === 'GOLDEN' ? 'GOLDEN' : 'NORMAL';
    const pity = bounded(form.get('pity'), 0, MYTHIQUE_PITY - 1, 0);
    try {
      const opened = await trialBooster(user.id, kind, pity);
      return { opened: { ...opened, cards: await withArt(user.id, opened.cards) } };
    } catch (cause) {
      if (cause instanceof BoosterError) return fail(400, { error: m.boosters_no_cards() });
      throw cause;
    }
  },
  /** Ouvre beaucoup de boosters à blanc et compte ce qui sort. */
  simulate: async ({ locals, request }) => {
    const user = requireModerator(locals);
    if (!rateLimit(`trial-simulation:${user.id}`, 20, 60_000))
      return fail(429, { error: m.too_fast() });
    const count = bounded((await request.formData()).get('count'), 1, SIMULATION_MAX, 1000);
    try {
      return { simulation: await simulateBoosters(count) };
    } catch (cause) {
      if (cause instanceof BoosterError) return fail(400, { error: m.boosters_no_cards() });
      throw cause;
    }
  },
};
