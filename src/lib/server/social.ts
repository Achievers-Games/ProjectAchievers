import { Prisma, type PrismaClient } from '@prisma/client';
import { randomToken } from './crypto';
import { db } from './db';
import { slugify } from '$lib/slug';
import { notify } from './push';
import { publicUser } from './queries';
import { publishChat } from './sync/events';
import { m } from '$lib/paraglide/messages';

const MESSAGES_SHOWN = 100;
const PUSH_PREVIEW = 120;
const MAX_CLAN_MEMBERS = 50;

export type SocialFailure =
  | 'not_found'
  | 'self'
  | 'blocked'
  | 'name_taken'
  | 'in_clan'
  | 'clan_full'
  | 'owner_only'
  | 'not_friends';

export type Relation = 'self' | 'none' | 'sent' | 'received' | 'friends' | 'blocked';

const personSelect = { id: true, ...publicUser } satisfies Prisma.UserSelect;

/** Un même couple de joueurs n'a qu'une discussion, quel que soit celui qui l'ouvre. */
export const directKey = (a: string, b: string) => [a, b].toSorted().join(':');

const pair = (a: string, b: string) => [
  { requesterId: a, addresseeId: b },
  { requesterId: b, addresseeId: a },
];

const isBlocked = async (a: string, b: string) =>
  (await db.block.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  })) > 0;

export async function relationWith(userId: string, otherId: string): Promise<Relation> {
  if (userId === otherId) return 'self';
  if (await isBlocked(userId, otherId)) return 'blocked';
  const link = await db.friendship.findFirst({ where: { OR: pair(userId, otherId) } });
  if (!link) return 'none';
  if (link.accepted) return 'friends';
  return link.requesterId === userId ? 'sent' : 'received';
}

async function inviteNotice(userId: string, fromId: string, type: 'ami' | 'clan') {
  const { displayName: name } = await db.user.findUniqueOrThrow({
    where: { id: fromId },
    select: { displayName: true },
  });
  notify(userId, 'invite', `${type}:${fromId}`, (locale) =>
    type === 'ami'
      ? { title: name, body: m.push_friend_request({}, { locale }), url: '/amis' }
      : { title: name, body: m.push_clan_invite({}, { locale }), url: '/clan' },
  );
}

/** Un profil privé ne se trouve pas par son identifiant, et un blocage ne se devine pas. */
export async function requestFriend(userId: string, handle: string): Promise<SocialFailure | null> {
  const other = await db.user.findFirst({
    where: { handle: handle.trim().toLowerCase(), isPublic: true },
    select: { id: true },
  });
  if (!other || (await isBlocked(userId, other.id))) return 'not_found';
  if (other.id === userId) return 'self';

  const link = await db.friendship.findFirst({ where: { OR: pair(userId, other.id) } });
  if (!link) {
    await db.friendship.create({ data: { requesterId: userId, addresseeId: other.id } });
    await inviteNotice(other.id, userId, 'ami');
  } else if (!link.accepted && link.addresseeId === userId) {
    await db.friendship.update({ where: { id: link.id }, data: { accepted: true } });
  }
  return null;
}

export async function acceptFriend(userId: string, otherId: string) {
  await db.friendship.updateMany({
    where: { requesterId: otherId, addresseeId: userId },
    data: { accepted: true },
  });
}

/** Sert à refuser, à annuler une demande et à retirer un ami. */
export async function removeFriend(userId: string, otherId: string) {
  await db.friendship.deleteMany({ where: { OR: pair(userId, otherId) } });
}

export async function blockUser(userId: string, otherId: string) {
  if (userId === otherId) return;
  await db.$transaction([
    db.friendship.deleteMany({ where: { OR: pair(userId, otherId) } }),
    db.block.createMany({
      data: [{ blockerId: userId, blockedId: otherId }],
      skipDuplicates: true,
    }),
  ]);
}

export async function unblockUser(userId: string, otherId: string) {
  await db.block.deleteMany({ where: { blockerId: userId, blockedId: otherId } });
}

export async function friendsOverview(userId: string) {
  const [links, blocks] = await Promise.all([
    db.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      orderBy: { createdAt: 'desc' },
      select: {
        accepted: true,
        requesterId: true,
        requester: { select: personSelect },
        addressee: { select: personSelect },
      },
    }),
    db.block.findMany({
      where: { blockerId: userId },
      select: { blocked: { select: personSelect } },
    }),
  ]);
  const other = (link: (typeof links)[number]) =>
    link.requesterId === userId ? link.addressee : link.requester;
  return {
    friends: links.filter((link) => link.accepted).map(other),
    received: links.filter((l) => !l.accepted && l.requesterId !== userId).map(other),
    sent: links.filter((l) => !l.accepted && l.requesterId === userId).map(other),
    blocked: blocks.map((block) => block.blocked),
  };
}

/** Ouvre la discussion avec un ami, ou retrouve celle qui existe déjà. */
export async function openDirect(userId: string, otherId: string) {
  if ((await relationWith(userId, otherId)) !== 'friends') return null;
  const conversation = await db.conversation.upsert({
    where: { directKey: directKey(userId, otherId) },
    update: {},
    create: {
      directKey: directKey(userId, otherId),
      members: { create: [{ userId }, { userId: otherId }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

export async function listConversations(userId: string) {
  const rows = await db.conversationMember.findMany({
    where: { userId },
    select: {
      lastReadAt: true,
      conversation: {
        select: {
          id: true,
          clan: { select: { name: true } },
          members: { where: { NOT: { userId } }, select: { user: { select: personSelect } } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, createdAt: true },
          },
        },
      },
    },
  });
  const unread = await Promise.all(
    rows.map(({ conversation, lastReadAt }) =>
      db.message.count({
        where: {
          conversationId: conversation.id,
          createdAt: { gte: lastReadAt },
          NOT: { authorId: userId },
        },
      }),
    ),
  );
  return rows
    .map(({ conversation }, index) => {
      const [last] = conversation.messages;
      const person = conversation.members[0]?.user ?? null;
      return {
        id: conversation.id,
        title: conversation.clan?.name ?? person?.displayName ?? '',
        person: conversation.clan ? null : person,
        preview: last?.content ?? '',
        at: last?.createdAt ?? null,
        unread: unread[index] ?? 0,
      };
    })
    .filter((row) => row.title)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

export async function unreadCount(userId: string) {
  const [{ count } = { count: 0n }] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
    FROM "ConversationMember" cm
    JOIN "Message" m ON m."conversationId" = cm."conversationId"
    WHERE cm."userId" = ${userId} AND m."createdAt" >= cm."lastReadAt" AND m."authorId" <> ${userId}`;
  return Number(count);
}

export async function markRead(userId: string, conversationId: string) {
  await db.conversationMember.updateMany({
    where: { userId, conversationId },
    data: { lastReadAt: new Date() },
  });
}

/** Renvoie les derniers messages, ou null si le joueur n'est pas dans cette discussion. */
export async function readConversation(userId: string, conversationId: string) {
  const member = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) return null;

  const [conversation] = (await listConversations(userId)).filter((c) => c.id === conversationId);
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: MESSAGES_SHOWN,
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: { select: personSelect },
    },
  });
  await markRead(userId, conversationId);
  return {
    id: conversationId,
    title: conversation?.title ?? '',
    person: conversation?.person ?? null,
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
      members: { select: { userId: true } },
    },
  });
  if (!conversation) return 'not_found';

  if (conversation.directKey) {
    const other = conversation.members.find((member) => member.userId !== userId);
    if (!other || (await relationWith(userId, other.userId)) !== 'friends') return 'not_friends';
  }

  const message = await db.message.create({
    data: { conversationId, authorId: userId, content },
    select: { id: true, content: true, createdAt: true, author: { select: personSelect } },
  });
  for (const member of conversation.members) {
    publishChat(member.userId, { type: 'chat', conversationId, message });
    if (member.userId === userId) continue;
    notify(member.userId, 'message', conversationId, () => ({
      title: conversation.clan?.name ?? message.author.displayName,
      body: content.slice(0, PUSH_PREVIEW),
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

export async function myClan(userId: string) {
  const membership = await db.clanMember.findUnique({
    where: { userId },
    select: {
      owner: true,
      clan: {
        select: {
          id: true,
          name: true,
          slug: true,
          conversation: { select: { id: true } },
          members: {
            orderBy: [{ owner: 'desc' }, { joinedAt: 'asc' }],
            select: { owner: true, user: { select: personSelect } },
          },
        },
      },
    },
  });
  const invites = await db.clanInvite.findMany({
    where: { userId },
    select: { clan: { select: { id: true, name: true } } },
  });
  return { membership, invites: invites.map((invite) => invite.clan) };
}

export async function createClan(userId: string, name: string): Promise<SocialFailure | null> {
  if (await db.clanMember.count({ where: { userId } })) return 'in_clan';
  try {
    await db.clan.create({
      data: {
        name,
        slug: slugify(name) || `clan-${randomToken(6).toLowerCase()}`,
        members: { create: { userId, owner: true } },
        conversation: { create: { members: { create: { userId } } } },
      },
    });
    return null;
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      return 'name_taken';
    }
    throw cause;
  }
}

/** Le chef invite ses amis ; personne n'entre dans un clan sans l'avoir accepté. */
export async function inviteToClan(
  userId: string,
  friendId: string,
): Promise<SocialFailure | null> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (!membership?.owner) return 'owner_only';
  if ((await relationWith(userId, friendId)) !== 'friends') return 'not_friends';
  await db.clanInvite.createMany({
    data: [{ clanId: membership.clanId, userId: friendId }],
    skipDuplicates: true,
  });
  await inviteNotice(friendId, userId, 'clan');
  return null;
}

export async function acceptClanInvite(
  userId: string,
  clanId: string,
): Promise<SocialFailure | null> {
  const invite = await db.clanInvite.findUnique({ where: { clanId_userId: { clanId, userId } } });
  if (!invite) return 'not_found';
  if (await db.clanMember.count({ where: { userId } })) return 'in_clan';
  if ((await db.clanMember.count({ where: { clanId } })) >= MAX_CLAN_MEMBERS) return 'clan_full';

  const conversation = await db.conversation.findUniqueOrThrow({
    where: { clanId },
    select: { id: true },
  });
  await db.$transaction([
    db.clanInvite.deleteMany({ where: { userId } }),
    db.clanMember.create({ data: { clanId, userId } }),
    db.conversationMember.create({ data: { conversationId: conversation.id, userId } }),
  ]);
  return null;
}

export async function declineClanInvite(userId: string, clanId: string) {
  await db.clanInvite.deleteMany({ where: { clanId, userId } });
}

/** Le clan survit au départ de son chef : le plus ancien membre prend sa place. */
export async function leaveClan(
  userId: string,
  client: Pick<PrismaClient, 'clan' | 'clanMember' | 'conversationMember'> = db,
) {
  const membership = await client.clanMember.findUnique({
    where: { userId },
    select: { clanId: true, owner: true, clan: { select: { conversation: true } } },
  });
  if (!membership) return;
  const { clanId, owner, clan } = membership;

  await client.clanMember.delete({ where: { userId } });
  if (clan.conversation) {
    await client.conversationMember.deleteMany({
      where: { conversationId: clan.conversation.id, userId },
    });
  }
  const next = await client.clanMember.findFirst({
    where: { clanId },
    orderBy: { joinedAt: 'asc' },
  });
  if (!next) await client.clan.delete({ where: { id: clanId } });
  else if (owner) {
    await client.clanMember.update({ where: { userId: next.userId }, data: { owner: true } });
  }
}

const publicMembers = { user: { isPublic: true } };

/** Les clans classés par succès cumulés : seuls les profils publics comptent. */
export async function listClans() {
  const rows = await db.$queryRaw<
    { name: string; slug: string; members: bigint; achievements: bigint }[]
  >`
    SELECT c.name, c.slug, count(DISTINCT cm."userId") AS members, count(ua."achievementId") AS achievements
    FROM "Clan" c
    JOIN "ClanMember" cm ON cm."clanId" = c.id
    JOIN "User" u ON u.id = cm."userId" AND u."isPublic"
    LEFT JOIN "UserAchievement" ua ON ua."userId" = cm."userId"
    GROUP BY c.id
    ORDER BY achievements DESC, c.name`;
  return rows.map((row) => ({
    ...row,
    members: Number(row.members),
    achievements: Number(row.achievements),
  }));
}

/** Page publique : le récapitulatif d'un clan, sans les profils privés. */
export async function clanPage(slug: string) {
  const clan = await db.clan.findUnique({
    where: { slug },
    select: {
      name: true,
      createdAt: true,
      members: {
        where: publicMembers,
        orderBy: { joinedAt: 'asc' },
        select: { owner: true, user: { select: personSelect } },
      },
    },
  });
  if (!clan) return null;

  const counts = await db.userAchievement.groupBy({
    by: ['userId'],
    where: { userId: { in: clan.members.map((member) => member.user.id) } },
    _count: { _all: true },
  });
  const byUser = new Map(counts.map((row) => [row.userId, row._count._all]));
  const members = clan.members
    .map(({ owner, user: { id, ...user } }) => ({
      owner,
      user,
      achievements: byUser.get(id) ?? 0,
    }))
    .sort((a, b) => b.achievements - a.achievements);
  return {
    name: clan.name,
    createdAt: clan.createdAt,
    members,
    achievements: members.reduce((sum, member) => sum + member.achievements, 0),
  };
}

export async function kickFromClan(userId: string, memberId: string) {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (!membership?.owner || memberId === userId) return 'owner_only';
  const target = await db.clanMember.count({
    where: { userId: memberId, clanId: membership.clanId },
  });
  if (target) await leaveClan(memberId);
  return null;
}
