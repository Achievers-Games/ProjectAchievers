import type { Cookies } from '@sveltejs/kit';
import type { Prisma, Provider, Role } from '@prisma/client';
import { secureCookie } from './cookies';
import { decrypt, encrypt } from './crypto';
import { db } from './db';
import { directKey, leaveClan } from './social';

const MERGE_COOKIE = 'pa_merge';

/** Tables qui n'acceptent qu'une ligne par utilisateur et par élément. */
const PER_USER_TABLES = [
  ['UserFrame', 'frame'],
  ['SiteUnlock', 'code'],
  ['PinnedGame', 'gameId'],
  ['UserGame', 'gameId'],
  ['UserAchievement', 'achievementId'],
  ['GuideVote', 'guideId'],
  ['CommentReaction', 'commentId'],
] as const;

type Transaction = Prisma.TransactionClient;

async function mergeClans(
  tx: Transaction,
  sourceId: string,
  targetId: string,
  choice: ClanChoice | undefined,
) {
  await tx.$executeRaw`
    DELETE FROM "ClanInvite" s USING "ClanInvite" t
    WHERE s."userId" = ${sourceId} AND t."userId" = ${targetId} AND s."clanId" = t."clanId"`;
  await tx.clanInvite.updateMany({ where: { userId: sourceId }, data: { userId: targetId } });

  const kept = await tx.clanMember.findUnique({ where: { userId: sourceId } });
  if (!kept) return;
  const targetHasClan = await tx.clanMember.count({ where: { userId: targetId } });
  if (targetHasClan && choice !== 'source') {
    await leaveClan(sourceId, tx);
    return;
  }
  if (targetHasClan) await leaveClan(targetId, tx);
  await tx.clanMember.update({ where: { userId: sourceId }, data: { userId: targetId } });
}

/** Deux discussions avec le même ami n'en font plus qu'une, messages compris. */
async function mergeConversations(tx: Transaction, sourceId: string, targetId: string) {
  const direct = await tx.conversation.findMany({
    where: { directKey: { not: null }, members: { some: { userId: sourceId } } },
    select: { id: true, directKey: true },
  });
  for (const conversation of direct) {
    const friend = conversation.directKey?.split(':').find((id) => id !== sourceId) as string;
    if (friend === targetId) {
      await tx.conversation.delete({ where: { id: conversation.id } });
      continue;
    }
    const key = directKey(targetId, friend);
    const existing = await tx.conversation.findUnique({ where: { directKey: key } });
    if (existing) {
      await tx.message.updateMany({
        where: { conversationId: conversation.id },
        data: { conversationId: existing.id },
      });
      await tx.conversation.delete({ where: { id: conversation.id } });
    } else {
      await tx.conversation.update({ where: { id: conversation.id }, data: { directKey: key } });
    }
  }
  await tx.$executeRaw`
    DELETE FROM "ConversationMember" s USING "ConversationMember" t
    WHERE s."userId" = ${sourceId} AND t."userId" = ${targetId}
      AND s."conversationId" = t."conversationId"`;
  await tx.conversationMember.updateMany({
    where: { userId: sourceId },
    data: { userId: targetId },
  });
  await tx.message.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } });
}

const ROLE_RANK: Record<Role, number> = { USER: 0, MODERATOR: 1, ADMIN: 2 };

export interface PendingMerge {
  /** Profil absorbé, puis supprimé. */
  sourceId: string;
  /** Profil conservé : celui de la session en cours. */
  targetId: string;
  provider: Provider;
  providerUserId: string;
}

type MergeFailure = 'stale' | 'sync_running' | 'provider_conflict' | 'clan_choice';

/** Le clan à garder quand les deux profils en ont un. */
export type ClanChoice = 'source' | 'target';

/** La demande reste chez le navigateur, chiffrée, pendant 10 minutes. */
export function saveMerge(cookies: Cookies, merge: PendingMerge) {
  cookies.set(MERGE_COOKIE, encrypt(JSON.stringify(merge)), {
    ...secureCookie,
    path: '/compte',
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
        clanMember: { select: { clan: { select: { name: true } } } },
        _count: { select: { games: true, guides: true, comments: true } },
      },
    }),
    db.linkedAccount.findMany({ where: { userId: merge.targetId }, select: { provider: true } }),
  ]);
  const targetClan = await db.clanMember.findUnique({
    where: { userId: merge.targetId },
    select: { clan: { select: { name: true } } },
  });
  if (!source) return null;

  const taken = new Set(targetAccounts.map((a) => a.provider));
  return {
    handle: source.handle,
    displayName: source.displayName,
    providers: source.accounts.map((a) => a.provider),
    conflicts: source.accounts.map((a) => a.provider).filter((p) => taken.has(p)),
    // Un joueur n'a qu'un clan : s'il en a deux, c'est à lui de choisir.
    clans:
      source.clanMember && targetClan
        ? { source: source.clanMember.clan.name, target: targetClan.clan.name }
        : null,
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
export async function mergeUsers(
  merge: PendingMerge,
  clanChoice?: ClanChoice,
): Promise<MergeFailure | null> {
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

      const [source, target, sourceClans, targetClans] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: sourceId } }),
        tx.user.findUniqueOrThrow({ where: { id: targetId } }),
        tx.clanMember.count({ where: { userId: sourceId } }),
        tx.clanMember.count({ where: { userId: targetId } }),
      ]);
      if (sourceClans && targetClans && !clanChoice) return 'clan_choice';

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
        DELETE FROM "GuideCheck" s USING "GuideCheck" t
        WHERE s."userId" = ${sourceId} AND t."userId" = ${targetId}
          AND s."guideId" = t."guideId" AND s."item" = t."item"`;
      await tx.$executeRaw`
        DELETE FROM "Report" s USING "Report" t
        WHERE s."reporterId" = ${sourceId} AND t."reporterId" = ${targetId}
          AND s."targetType" = t."targetType" AND s."targetId" = t."targetId"`;

      const owner = { where: { userId: sourceId }, data: { userId: targetId } };
      await tx.linkedAccount.updateMany(owner);
      await tx.userGame.updateMany(owner);
      await tx.userAchievement.updateMany(owner);
      await tx.guideVote.updateMany(owner);
      await tx.feedback.updateMany(owner);
      await tx.guideCheck.updateMany(owner);
      await tx.commentReaction.updateMany(owner);
      await tx.syncRun.updateMany(owner);
      await tx.userFrame.updateMany(owner);
      await tx.siteUnlock.updateMany(owner);
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

      // Rien de social ne se perd : amis, blocages, clan et discussions suivent le profil gardé.
      await tx.$executeRaw`
        DELETE FROM "Friendship" s
        WHERE (s."requesterId" = ${sourceId} AND s."addresseeId" = ${targetId})
           OR (s."requesterId" = ${targetId} AND s."addresseeId" = ${sourceId})`;
      await tx.$executeRaw`
        DELETE FROM "Friendship" s
        WHERE (s."requesterId" = ${sourceId} OR s."addresseeId" = ${sourceId})
          AND EXISTS (
            SELECT 1 FROM "Friendship" t
            WHERE (t."requesterId" = ${targetId} OR t."addresseeId" = ${targetId})
              AND CASE WHEN t."requesterId" = ${targetId} THEN t."addresseeId" ELSE t."requesterId" END
                = CASE WHEN s."requesterId" = ${sourceId} THEN s."addresseeId" ELSE s."requesterId" END
          )`;
      await tx.friendship.updateMany({
        where: { requesterId: sourceId },
        data: { requesterId: targetId },
      });
      await tx.friendship.updateMany({
        where: { addresseeId: sourceId },
        data: { addresseeId: targetId },
      });
      await tx.$executeRaw`
        INSERT INTO "Block" ("blockerId", "blockedId")
        SELECT ${targetId}, "blockedId" FROM "Block"
        WHERE "blockerId" = ${sourceId} AND "blockedId" <> ${targetId}
        ON CONFLICT DO NOTHING`;
      await mergeClans(tx, sourceId, targetId, clanChoice);
      await mergeConversations(tx, sourceId, targetId);

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
