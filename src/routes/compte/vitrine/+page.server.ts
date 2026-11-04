import { fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { chosenCards, MAX_SHOWCASE, userCards } from '#lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

const requireUser = (locals: App.Locals) => requireLogin(locals, '/compte/vitrine');

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const q = url.searchParams.get('q')?.trim().toLowerCase().slice(0, 80) || '';

  const [profile, cards, pins] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { showcaseCustom: true } }),
    userCards(user.id, true),
    db.pinnedGame.findMany({
      where: { userId: user.id },
      orderBy: { position: 'asc' },
      select: { game: { select: { slug: true } } },
    }),
  ]);
  const selected = chosenCards(
    cards,
    pins.map((pin) => pin.game.slug),
  );
  const taken = new Set(selected.map((card) => card.id));

  return {
    q,
    max: MAX_SHOWCASE,
    custom: profile.showcaseCustom,
    selected,
    available: cards.filter((card) => !taken.has(card.id) && card.name.toLowerCase().includes(q)),
  };
};

export const actions: Actions = {
  mode: async ({ request, locals }) => {
    const user = requireUser(locals);
    const showcaseCustom = (await request.formData()).get('mode') === 'custom';
    await db.user.update({ where: { id: user.id }, data: { showcaseCustom } });
  },

  add: async ({ request, locals }) => {
    const user = requireUser(locals);
    const slug = String((await request.formData()).get('slug'));

    const cards = await userCards(user.id, true);
    if (!cards.some((card) => card.versions.some((version) => version.slug === slug))) {
      return fail(403, { error: m.showcase_not_owned() });
    }
    const pins = await db.pinnedGame.findMany({
      where: { userId: user.id },
      select: { position: true, game: { select: { slug: true } } },
    });
    // Une carte épinglée puis cachée ou perdue ne prend pas de place dans la vitrine.
    const shown = chosenCards(
      cards,
      pins.map((pin) => pin.game.slug),
    );
    if (shown.length >= MAX_SHOWCASE) {
      return fail(409, { error: m.showcase_full({ max: MAX_SHOWCASE }) });
    }

    const game = await db.game.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    const position = Math.max(-1, ...pins.map((pin) => pin.position)) + 1;
    await db.pinnedGame.createMany({
      data: [{ userId: user.id, gameId: game.id, position }],
      skipDuplicates: true,
    });
  },

  remove: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const slugs = form.getAll('slug').map(String);
    await db.pinnedGame.deleteMany({ where: { userId: user.id, game: { slug: { in: slugs } } } });
  },

  move: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const slugs = form.getAll('slug').map(String);
    const [cards, allPins] = await Promise.all([
      userCards(user.id, true),
      db.pinnedGame.findMany({
        where: { userId: user.id },
        orderBy: { position: 'asc' },
        include: { game: { select: { slug: true } } },
      }),
    ]);
    // On échange deux cartes visibles : les épingles d'une carte cachée ne comptent pas.
    const pins = allPins.filter((pin) => chosenCards(cards, [pin.game.slug]).length > 0);

    const index = pins.findIndex((pin) => slugs.includes(pin.game.slug));
    const other = pins[index + (form.get('direction') === 'up' ? -1 : 1)];
    const current = pins[index];
    if (!current || !other) return;

    const key = (gameId: string) => ({ userId_gameId: { userId: user.id, gameId } });
    await db.$transaction([
      db.pinnedGame.update({
        where: key(current.gameId),
        data: { position: other.position },
      }),
      db.pinnedGame.update({
        where: key(other.gameId),
        data: { position: current.position },
      }),
    ]);
  },
};
