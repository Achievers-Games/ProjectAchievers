import { error } from '@sveltejs/kit';
import type { Prisma } from '#prisma';
import { m } from '#lib/paraglide/messages';
import { db } from './db';
import { renderGuide } from './markdown';

/** Score net à partir duquel la communauté a jugé un guide mauvais : il se replie par défaut. */
export const BURIED_SCORE = -5;

/** Un guide officiel ne se replie jamais : l'équipe en répond. */
export const isBuried = (guide: { score: number; curatedKey: string | null }) =>
  guide.curatedKey === null && guide.score <= BURIED_SCORE;

/** Les guides officiels d'abord, puis les mieux notés ; à égalité, le premier écrit. */
export const GUIDE_ORDER = [
  { curatedKey: { sort: 'asc', nulls: 'last' } },
  { score: 'desc' },
  { createdAt: 'asc' },
] satisfies Prisma.GuideOrderByWithRelationInput[];

/** Les guides de jeu valent pour toutes les versions du jeu : elles partagent leurs succès. */
export const gameGuidesWhere = (game: { id: string; familyKey: string | null }) =>
  ({
    status: 'PUBLISHED',
    game: game.familyKey ? { familyKey: game.familyKey } : { id: game.id },
  }) satisfies Prisma.GuideWhereInput;

/**
 * Un vote par joueur : voter pareil le retire, voter l'inverse le remplace.
 * Rend le nouveau score, ou `null` si le guide n'est plus publié.
 */
export async function voteGuide(guideId: string, userId: string, value: 1 | -1) {
  return db.$transaction(async (tx) => {
    // Le verrou fait passer les votes d'un même guide l'un après l'autre : chaque total les voit tous.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Guide" WHERE "id" = ${guideId} AND "status" = 'PUBLISHED' FOR UPDATE`;
    if (!locked.length) return null;
    const key = { guideId_userId: { guideId, userId } };
    const current = await tx.guideVote.findUnique({ where: key });
    if (current?.value === value) await tx.guideVote.delete({ where: key });
    else {
      await tx.guideVote.upsert({
        where: key,
        update: { value },
        create: { guideId, userId, value },
      });
    }
    const { _sum } = await tx.guideVote.aggregate({ where: { guideId }, _sum: { value: true } });
    const score = _sum.value ?? 0;
    await tx.guide.update({ where: { id: guideId }, data: { score } });
    return { score, myVote: current?.value === value ? 0 : value };
  });
}

/** Les modérateurs et les administrateurs reprennent les guides officiels depuis le site. */
export const canEditOfficial = (user: { role: string } | null | undefined) =>
  user?.role === 'MODERATOR' || user?.role === 'ADMIN';

/**
 * Les guides qu'un joueur peut reprendre : les siens, ou les officiels s'il modère. Un guide
 * officiel ne se supprime pas depuis le site : seul le dépôt le retire.
 */
export const editableGuides = (user: { id: string; role: string }) =>
  ({
    status: 'PUBLISHED',
    OR: [
      { authorId: user.id, curatedKey: null },
      ...(canEditOfficial(user) ? [{ curatedKey: { not: null } }] : []),
    ],
  }) satisfies Prisma.GuideWhereInput;

/** Le texte change : ses traductions ne valent plus, les votes restent acquis. */
export async function editGuide(
  id: string,
  user: { id: string; role: string },
  data: { contentMd: string; title?: string | null },
) {
  return db.$transaction(async (tx) => {
    const own = await tx.guide.count({ where: { id, ...editableGuides(user) } });
    if (!own) return false;
    await tx.contentTranslation.deleteMany({ where: { guideId: id } });
    await tx.guide.update({ where: { id }, data });
    return true;
  });
}

/** Rien n'est gardé du texte : le guide reste seulement pour que ses signalements aboutissent. */
export async function deleteGuide(id: string, authorId: string) {
  await db.contentTranslation.deleteMany({ where: { guideId: id, guide: { authorId } } });
  const { count } = await db.guide.updateMany({
    where: { id, authorId, curatedKey: null },
    data: { status: 'DELETED', contentMd: '', title: null },
  });
  return count > 0;
}

/** Coche ou décoche une case d'un guide publié. */
export async function checkGuideItem(
  guideId: string,
  userId: string,
  item: number,
  checked: boolean,
) {
  const guide = await db.guide.count({ where: { id: guideId, status: 'PUBLISHED' } });
  if (!guide) return false;
  if (checked) {
    await db.guideCheck.createMany({ data: [{ guideId, item, userId }], skipDuplicates: true });
  } else {
    await db.guideCheck.deleteMany({ where: { guideId, item, userId } });
  }
  return true;
}

/** Un signalement par joueur et par guide : le renvoyer met la raison à jour. */
export async function reportGuide(guideId: string, reporterId: string, reason: string) {
  if (!(await db.guide.count({ where: { id: guideId } }))) return false;
  await db.report.upsert({
    where: {
      reporterId_targetType_targetId: { reporterId, targetType: 'GUIDE', targetId: guideId },
    },
    update: { reason },
    create: { reporterId, targetType: 'GUIDE', targetId: guideId, reason },
  });
  return true;
}

/**
 * Le nombre de cases à cocher d'un guide, compté sur le rendu lui-même : une case écrite dans un
 * bloc de code ne s'affiche pas, et un décompte fait sur le Markdown la comptait quand même.
 */
export const countChecklist = (contentMd: string) =>
  renderGuide(contentMd).match(/data-check="/g)?.length ?? 0;

/** Le jeu d'une page de guide, avec ce qu'il faut pour retrouver les guides de ses versions. */
export async function guideGame(slug: string, user: App.Locals['user']) {
  const game = await db.game.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, familyKey: true, adultOnly: true },
  });
  if (!game || (game.adultOnly && !user?.showAdult)) error(404, m.game_not_found());
  return game;
}
