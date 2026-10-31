import type { Cookies } from '@sveltejs/kit';
import type { Provider, Role } from '@prisma/client';
import { decrypt, encrypt } from './crypto';
import { db } from './db';

const MERGE_COOKIE = 'pa_merge';

/** Tables qui n'acceptent qu'une ligne par utilisateur et par élément. */
const PER_USER_TABLES = [
  ['UserFrame', 'frame'],
  ['PinnedGame', 'gameId'],
  ['UserGame', 'gameId'],
  ['UserAchievement', 'achievementId'],
  ['GuideVote', 'guideId'],
  ['CommentReaction', 'commentId'],
] as const;

const ROLE_RANK: Record<Role, number> = { USER: 0, MODERATOR: 1, ADMIN: 2 };

export interface PendingMerge {
  /** Profil absorbé, puis supprimé. */
  sourceId: string;
  /** Profil conservé : celui de la session en cours. */
  targetId: string;
  provider: Provider;
  providerUserId: string;
}

type MergeFailure = 'stale' | 'sync_running' | 'provider_conflict';

/** La demande reste chez le navigateur, chiffrée, pendant 10 minutes. */
export function saveMerge(cookies: Cookies, merge: PendingMerge) {
  cookies.set(MERGE_COOKIE, encrypt(JSON.stringify(merge)), {
    path: '/compte',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
  });
}

export function clearMerge(cookies: Cookies) {
  cookies.delete(MERGE_COOKIE, { path: '/compte' });
}

/** N'accepte qu'une demande créée pour le profil connecté. */
export function readMerge(cookies: Cookies, userId: string): PendingMerge | null {
  const sealed = cookies.get(MERGE_COOKIE);
  if (!sealed) return null;
  try {
    const merge = JSON.parse(decrypt(sealed)) as PendingMerge;
    return merge.targetId === userId ? merge : null;
  } catch {
    return null;
  }
}

export async function mergePreview(merge: PendingMerge) {
  const [source, targetAccounts] = await Promise.all([
    db.user.findUnique({
      where: { id: merge.sourceId },
      select: {
        handle: true,
        displayName: true,
        accounts: { select: { provider: true } },
        _count: { select: { games: true, guides: true, comments: true } },
      },
    }),
    db.linkedAccount.findMany({ where: { userId: merge.targetId }, select: { provider: true } }),
  ]);
  if (!source) return null;

  const taken = new Set(targetAccounts.map((a) => a.provider));
  return {
    handle: source.handle,
    displayName: source.displayName,
    providers: source.accounts.map((a) => a.provider),
    conflicts: source.accounts.map((a) => a.provider).filter((p) => taken.has(p)),
    games: source._count.games,
    guides: source._count.guides,
    comments: source._count.comments,
  };
}

/**
 * Fusionne deux profils dont la même personne a prouvé la possession : elle est
 * connectée au profil conservé et vient de s'authentifier sur un compte de l'autre.
 *
 * Tant que les deux profils portent un compte du même fournisseur, la fusion est
 * refusée : garder l'un des deux en silence ferait perdre une bibliothèque.
 */
export async function mergeUsers(merge: PendingMerge): Promise<MergeFailure | null> {
  const { sourceId, targetId, provider, providerUserId } = merge;

  return db.$transaction(
    async (tx) => {
      const proof = await tx.linkedAccount.findUnique({
        where: { provider_providerUserId: { provider, providerUserId } },
        select: { userId: true },
      });
      if (proof?.userId !== sourceId || sourceId === targetId) return 'stale';

      const accounts = await tx.linkedAccount.findMany({
        where: { userId: { in: [sourceId, targetId] } },
        select: { userId: true, provider: true, syncStatus: true },
      });
      if (accounts.some((a) => a.syncStatus === 'QUEUED' || a.syncStatus === 'SYNCING')) {
        return 'sync_running';
      }
      const taken = new Set(accounts.filter((a) => a.userId === targetId).map((a) => a.provider));
      if (accounts.some((a) => a.userId === sourceId && taken.has(a.provider))) {
        return 'provider_conflict';
      }

      const [source, target] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: sourceId } }),
        tx.user.findUniqueOrThrow({ where: { id: targetId } }),
      ]);

      // En cas de doublon, la ligne du profil conservé fait foi.
      for (const [table, key] of PER_USER_TABLES) {
        await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" s USING "${table}" t
           WHERE s."userId" = $1 AND t."userId" = $2 AND s."${key}" = t."${key}"`,
          sourceId,
          targetId,
        );
      }
      await tx.$executeRaw`
        DELETE FROM "Report" s USING "Report" t
        WHERE s."reporterId" = ${sourceId} AND t."reporterId" = ${targetId}
          AND s."targetType" = t."targetType" AND s."targetId" = t."targetId"`;

      const owner = { where: { userId: sourceId }, data: { userId: targetId } };
      await tx.linkedAccount.updateMany(owner);
      await tx.userGame.updateMany(owner);
      await tx.userAchievement.updateMany(owner);
      await tx.guideVote.updateMany(owner);
      await tx.commentReaction.updateMany(owner);
      await tx.syncRun.updateMany(owner);
      await tx.userFrame.updateMany(owner);
      await tx.pinnedGame.updateMany(owner);

      const author = { where: { authorId: sourceId }, data: { authorId: targetId } };
      await tx.guide.updateMany(author);
      await tx.comment.updateMany(author);
      await tx.report.updateMany({
        where: { reporterId: sourceId },
        data: { reporterId: targetId },
      });

      // Un vote écarté comme doublon ne compte plus dans le score du guide.
      await tx.$executeRaw`
        UPDATE "Guide" g
        SET "score" = COALESCE((SELECT SUM(v."value") FROM "GuideVote" v WHERE v."guideId" = g."id"), 0)
        WHERE g."id" IN (SELECT "guideId" FROM "GuideVote" WHERE "userId" = ${targetId})`;

      await tx.psnVerification.deleteMany({ where: { userId: sourceId } });
      await tx.user.update({
        where: { id: targetId },
        data: {
          // Un profil privé ne doit pas devenir public à cause d'une fusion.
          isPublic: source.isPublic && target.isPublic,
          role: ROLE_RANK[source.role] > ROLE_RANK[target.role] ? source.role : target.role,
          avatarUrl: target.avatarUrl ?? source.avatarUrl,
          avatarMotionUrl: target.avatarUrl ? target.avatarMotionUrl : source.avatarMotionUrl,
          frame: target.frame ?? source.frame,
          showcaseCustom: target.showcaseCustom || source.showcaseCustom,
          frameMotionUrl: target.frame ? target.frameMotionUrl : source.frameMotionUrl,
        },
      });
      await tx.user.delete({ where: { id: sourceId } });
      return null;
    },
    { isolationLevel: 'Serializable' },
  );
}
