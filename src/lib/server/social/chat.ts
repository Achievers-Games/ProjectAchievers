import { getLocale } from '#lib/paraglide/runtime';
import { censor } from '#lib/profanity';
import { db } from '../db';
import { notify } from '../push';
import { publishChat } from '../sync/events';
import { relationWith } from './friends';
import {
  MESSAGES_SHOWN,
  PUSH_PREVIEW,
  directKey,
  personSelect,
  type SocialFailure,
} from './shared';

/**
 * Les auteurs dont un joueur lit les messages. Un clan réunit parfois deux joueurs brouillés :
 * chacun cesse alors de voir ce qu'écrit l'autre.
 */
const visibleTo = (userId: string) => ({
  blocks: { none: { blockedId: userId } },
  blockedBy: { none: { blockerId: userId } },
});

/** Ouvre la discussion avec un ami, ou retrouve celle qui existe déjà. */
export async function openDirect(userId: string, otherId: string) {
  if ((await relationWith(userId, otherId)) !== 'friends') return null;
  const conversation = await db.conversation.upsert({
    where: { directKey: directKey(userId, otherId) },
    update: {},
    create: {
      directKey: directKey(userId, otherId),
      // Rien n'est lu au départ : le tout premier message compte toujours comme non lu.
      members: {
        create: [
          { userId, lastReadAt: new Date(0) },
          { userId: otherId, lastReadAt: new Date(0) },
        ],
      },
    },
    select: { id: true },
  });
  return conversation.id;
}

export async function listConversations(userId: string) {
  const rows = await db.conversationMember.findMany({
    where: { userId },
    select: {
      conversation: {
        select: {
          id: true,
          clan: { select: { name: true } },
          members: {
            where: { NOT: { userId } },
            take: 1,
            select: { user: { select: personSelect } },
          },
          messages: {
            where: { author: visibleTo(userId) },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, locale: true, createdAt: true },
          },
        },
      },
    },
  });
  const unread = await unreadByConversation(userId);
  return rows
    .map(({ conversation }) => {
      const [last] = conversation.messages;
      const person = conversation.members[0]?.user ?? null;
      return {
        id: conversation.id,
        title: conversation.clan?.name ?? person?.displayName ?? '',
        person: conversation.clan ? null : person,
        preview: last?.content ?? '',
        previewLocale: last?.locale ?? null,
        at: last?.createdAt ?? null,
        unread: unread.get(conversation.id) ?? 0,
      };
    })
    .filter((row) => row.title)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

async function unreadByConversation(userId: string) {
  const rows = await db.$queryRaw<{ conversationId: string; count: bigint }[]>`
    SELECT m."conversationId", count(*) AS count
    FROM "ConversationMember" cm
    JOIN "Message" m ON m."conversationId" = cm."conversationId"
    WHERE cm."userId" = ${userId} AND m."createdAt" > cm."lastReadAt" AND m."authorId" <> ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM "Block" b
        WHERE (b."blockerId" = ${userId} AND b."blockedId" = m."authorId")
           OR (b."blockerId" = m."authorId" AND b."blockedId" = ${userId})
      )
    GROUP BY 1`;
  return new Map(rows.map((row) => [row.conversationId, Number(row.count)]));
}

export async function unreadCount(userId: string) {
  const unread = await unreadByConversation(userId);
  return [...unread.values()].reduce((sum, count) => sum + count, 0);
}

/** Le nom affiché d'une discussion, ou null si le joueur n'en fait pas partie. */
export async function conversationTitle(userId: string, conversationId: string) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId } } },
    select: {
      clan: { select: { name: true } },
      members: {
        where: { NOT: { userId } },
        take: 1,
        select: { user: { select: { displayName: true } } },
      },
    },
  });
  if (!conversation) return null;
  return conversation.clan?.name ?? conversation.members[0]?.user.displayName ?? '';
}

export async function markRead(userId: string, conversationId: string, through: Date) {
  await db.conversationMember.updateMany({
    where: { userId, conversationId, lastReadAt: { lt: through } },
    data: { lastReadAt: through },
  });
}

/** Renvoie les derniers messages, ou null si le joueur n'est pas dans cette discussion. */
export async function readConversation(userId: string, conversationId: string) {
  const title = await conversationTitle(userId, conversationId);
  if (title === null) return null;

  const messages = await db.message.findMany({
    // Un clan réunit parfois deux joueurs brouillés : chacun cesse de voir les messages de l'autre.
    where: { conversationId, author: visibleTo(userId) },
    orderBy: { createdAt: 'desc' },
    take: MESSAGES_SHOWN,
    select: {
      id: true,
      content: true,
      locale: true,
      createdAt: true,
      author: { select: personSelect },
    },
  });
  if (messages[0]) await markRead(userId, conversationId, messages[0].createdAt);
  return {
    id: conversationId,
    title,
    messages: messages.reverse(),
  };
}

export type ChatMessage = NonNullable<
  Awaited<ReturnType<typeof readConversation>>
>['messages'][number];

export async function sendMessage(
  userId: string,
  conversationId: string,
  content: string,
): Promise<ChatMessage | SocialFailure> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId } } },
    select: {
      directKey: true,
      clan: { select: { name: true } },
      members: { select: { userId: true, user: { select: { allowProfanity: true } } } },
    },
  });
  if (!conversation) return 'not_found';

  if (conversation.directKey) {
    const other = conversation.members.find((member) => member.userId !== userId);
    if (!other || (await relationWith(userId, other.userId)) !== 'friends') return 'not_friends';
  }

  const message = await db.message.create({
    data: { conversationId, authorId: userId, content, locale: getLocale(), createdAt: new Date() },
    select: {
      id: true,
      content: true,
      locale: true,
      createdAt: true,
      author: { select: personSelect },
    },
  });
  // Dans le chat d'un clan, un blocage tient toujours : rien n'arrive en direct ni par notification.
  const blocks = conversation.clan
    ? await db.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      })
    : [];
  const shielded = new Set(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
  shielded.delete(userId);
  const censored = censor(content, message.locale);
  for (const member of conversation.members) {
    if (shielded.has(member.userId)) continue;
    publishChat(member.userId, { type: 'chat', conversationId, message });
    if (member.userId === userId) continue;
    notify(member.userId, 'message', conversationId, () => ({
      title: conversation.clan?.name ?? message.author.displayName,
      body: (member.user.allowProfanity ? content : censored).slice(0, PUSH_PREVIEW),
      url: `/messages/${conversationId}`,
    }));
  }
  return message;
}

/** Seul un participant peut signaler un message : la modération ne lit que celui-ci. */
export async function reportMessage(userId: string, messageId: string, reason: string) {
  const message = await db.message.count({
    where: { id: messageId, conversation: { members: { some: { userId } } } },
  });
  if (!message) return false;
  await db.report.upsert({
    where: {
      reporterId_targetType_targetId: {
        reporterId: userId,
        targetType: 'MESSAGE',
        targetId: messageId,
      },
    },
    update: { reason },
    create: { reporterId: userId, targetType: 'MESSAGE', targetId: messageId, reason },
  });
  return true;
}
