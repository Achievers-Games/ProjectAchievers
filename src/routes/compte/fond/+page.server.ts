import { fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { fetchSteamLook } from '#lib/server/providers/steam';
import { artNow } from '#lib/server/sync/content';
import { onePerFamily, toBanner, userProfile, type ProfileBackground } from '#lib/server/queries';
import { thumbArt } from '#lib/art';
import type { Actions, PageServerLoad } from './$types';

/** Assez pour choisir sans charger toute une bibliothèque Steam : la recherche fait le reste. */
const SHOWN = 48;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/compte/fond');

/**
 * La bannière (en-tête du profil et carte de joueur) et le fond de la page se règlent pareil,
 * chacun dans ses colonnes.
 */
const TARGETS = {
  banniere: { game: 'bannerGameId', steam: 'bannerSteam', off: 'bannerOff' },
  fond: { game: 'backgroundGameId', steam: 'backgroundSteam', off: 'backgroundOff' },
} as const;
type Target = keyof typeof TARGETS;

const targetOf = (value: unknown): Target => (value === 'fond' ? 'fond' : 'banniere');

type Mode = 'auto' | 'steam' | 'game' | 'off';

/** Ce que le joueur a réglé pour une cible : retirée, son fond Steam, un jeu, ou la vitrine. */
const modeOf = (
  profile: Record<'bannerOff' | 'bannerSteam' | 'backgroundOff' | 'backgroundSteam', boolean> &
    Record<'bannerGameId' | 'backgroundGameId', string | null>,
  target: Target,
): Mode => {
  const fields = TARGETS[target];
  if (profile[fields.off]) return 'off';
  if (profile[fields.steam]) return 'steam';
  return profile[fields.game] ? 'game' : 'auto';
};

/** L'image affichée aujourd'hui, réduite à ce que l'aperçu dessine : ses images et son jeu. */
const shown = (art: ProfileBackground | null) =>
  art ? { images: art.images, name: art.kind === 'game' ? art.name : null } : null;

/**
 * Le fond équipé sur Steam, relu à l'ouverture de la page : le joueur vient peut-être d'en
 * changer. Si Steam ne répond pas, le dernier connu reste valable.
 */
async function steamBackground(userId: string) {
  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: { id: true, providerUserId: true, backgroundUrl: true, backgroundMotionUrl: true },
  });
  if (!account) return null;
  const look = await fetchSteamLook(account.providerUserId);
  const url = look ? (look.backgroundUrl ?? null) : account.backgroundUrl;
  const motion = look ? (look.backgroundMotionUrl ?? null) : account.backgroundMotionUrl;
  if (url !== account.backgroundUrl || motion !== account.backgroundMotionUrl) {
    await db.linkedAccount.update({
      where: { id: account.id },
      data: { backgroundUrl: url, backgroundMotionUrl: motion },
    });
  }
  return { url, motion };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const q = url.searchParams.get('q')?.trim().slice(0, 80) || '';
  const target = targetOf(url.searchParams.get('cible'));
  const fields = TARGETS[target];

  const [profile, steam, rows, look] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        handle: true,
        backgroundOff: true,
        backgroundSteam: true,
        backgroundGameId: true,
        bannerOff: true,
        bannerSteam: true,
        bannerGameId: true,
      },
    }),
    steamBackground(user.id),
    db.userGame.findMany({
      where: {
        userId: user.id,
        hidden: false,
        game: {
          headerUrl: { not: null },
          // Une icône de trophée PlayStation ou Xbox étirée en fond est laide : seuls les jeux qui
          // ont une grande image se proposent (images de la boutique Steam, ou d'un jeu Steam).
          OR: [{ artUrl: { not: null } }, { heroUrl: { not: null } }, { platform: 'STEAM' }],
          ...(q && { name: { contains: q, mode: 'insensitive' } }),
        },
      },
      orderBy: [{ lastPlayedAt: { sort: 'desc', nulls: 'last' } }, { game: { name: 'asc' } }],
      // Un jeu possédé sur plusieurs plateformes revient plusieurs fois : on en lit plus, puis on
      // ne garde qu'une version par famille.
      take: SHOWN * 3,
      select: {
        game: {
          select: {
            id: true,
            name: true,
            slug: true,
            headerUrl: true,
            artUrl: true,
            heroUrl: true,
            platform: true,
            familyKey: true,
          },
        },
      },
    }),
    // Le profil tel qu'un visiteur le voit : l'aperçu montre exactement la même chose.
    userProfile(user.handle, user.id, user.showAdult),
  ]);
  const chosen = profile[fields.game];
  return {
    q,
    target,
    handle: profile.handle,
    mode: modeOf(profile, target),
    chosen,
    steam,
    preview: {
      person: look?.user ?? null,
      banner: { mode: modeOf(profile, 'banniere'), art: shown(look?.banner ?? null) },
      background: { mode: modeOf(profile, 'fond'), art: shown(look?.background ?? null) },
    },
    games: onePerFamily(
      rows.map((row) => row.game),
      chosen,
    )
      .slice(0, SHOWN)
      .map((game) => ({
        id: game.id,
        // Chaque onglet montre l'image qu'il posera : le bandeau pour la bannière, le fond de la
        // page boutique pour le fond.
        ...toBanner(
          { ...game, headerUrl: game.headerUrl as string },
          target === 'banniere' ? 'banner' : 'background',
        ),
        thumb: target === 'banniere' ? null : game.artUrl ? thumbArt(game.artUrl) : null,
      })),
  };
};

export const actions: Actions = {
  /** Le fond du profil Steam, le premier jeu de la vitrine, ou rien. */
  mode: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const mode = form.get('mode');
    const fields = TARGETS[targetOf(form.get('cible'))];
    if (mode === 'steam') {
      // Le jeu choisi reste en réserve : il revient si le joueur retire son fond sur Steam.
      await db.user.update({
        where: { id: user.id },
        data: { [fields.steam]: true, [fields.off]: false },
      });
    } else {
      await db.user.update({
        where: { id: user.id },
        data: { [fields.off]: mode === 'off', [fields.steam]: false, [fields.game]: null },
      });
    }
    return { success: m.background_saved() };
  },

  choose: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const gameId = String(form.get('game') ?? '');
    const fields = TARGETS[targetOf(form.get('cible'))];
    const owned = await db.userGame.findFirst({
      where: { userId: user.id, gameId, hidden: false, game: { headerUrl: { not: null } } },
      select: { gameId: true },
    });
    if (!owned) return fail(403, { error: m.showcase_not_owned() });
    await db.user.update({
      where: { id: user.id },
      data: { [fields.off]: false, [fields.steam]: false, [fields.game]: gameId },
    });
    // La capture plein écran tout de suite, sans attendre la tâche de fond : Steam répond vite.
    await artNow([gameId]).catch(() => 0);
    return { success: m.background_saved() };
  },
};
