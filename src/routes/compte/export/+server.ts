import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

/** Export RGPD : tout ce qui concerne l'utilisateur, sans les jetons chiffrés. */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());

  const data = await db.user.findUniqueOrThrow({
    where: { id: locals.user.id },
    select: {
      handle: true,
      displayName: true,
      avatarUrl: true,
      avatarMotionUrl: true,
      showOnline: true,
      pushMessages: true,
      pushInvites: true,
      pushEvents: true,
      frame: true,
      frameMotionUrl: true,
      isPublic: true,
      showAdult: true,
      allowProfanity: true,
      timeZone: true,
      createdAt: true,
      accounts: {
        select: {
          provider: true,
          providerUserId: true,
          displayName: true,
          linkedAt: true,
          lastSyncedAt: true,
        },
      },
      games: {
        select: {
          game: { select: { name: true } },
          unlockedCount: true,
          completion: true,
          hidden: true,
          playtimeMinutes: true,
        },
      },
      achievements: {
        select: {
          unlockedAt: true,
          achievement: { select: { name: true, game: { select: { name: true } } } },
        },
      },
      guides: { select: { contentMd: true, createdAt: true } },
      comments: { select: { contentMd: true, createdAt: true } },
      frames: { select: { frame: true, earnedAt: true } },
      siteUnlocks: { select: { code: true, unlockedAt: true } },
      pinned: { select: { position: true, game: { select: { name: true } } } },
      guideVotes: { select: { guideId: true, value: true } },
      friendRequests: { select: { addressee: { select: { handle: true } }, accepted: true } },
      friendReceived: { select: { requester: { select: { handle: true } }, accepted: true } },
      blocks: { select: { blocked: { select: { handle: true } }, createdAt: true } },
      clanMember: { select: { owner: true, joinedAt: true, clan: { select: { name: true } } } },
      messages: { select: { content: true, createdAt: true, conversationId: true } },
      pushSubscriptions: { select: { locale: true, createdAt: true } },
      feedback: {
        select: { kind: true, area: true, status: true, content: true, createdAt: true },
      },
      guideChecks: { select: { guideId: true, item: true } },
      reactions: { select: { commentId: true, type: true } },
      reports: { select: { targetType: true, targetId: true, reason: true, createdAt: true } },
      sessions: { select: { userAgent: true, createdAt: true, lastUsedAt: true } },
    },
  });

  return json(data, {
    headers: { 'Content-Disposition': 'attachment; filename="project-achievers.json"' },
  });
};
