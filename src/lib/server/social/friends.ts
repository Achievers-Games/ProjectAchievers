import { db } from '../db';
import {
  inviteNotice,
  isBlocked,
  pair,
  personSelect,
  type Relation,
  type SocialFailure,
} from './shared';

export async function relationWith(userId: string, otherId: string): Promise<Relation> {
  if (userId === otherId) return 'self';
  if (await isBlocked(userId, otherId)) return 'blocked';
  const link = await db.friendship.findFirst({ where: { OR: pair(userId, otherId) } });
  if (!link) return 'none';
  if (link.accepted) return 'friends';
  return link.requesterId === userId ? 'sent' : 'received';
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
    const { count } = await db.friendship.createMany({
      data: [{ requesterId: userId, addresseeId: other.id }],
      skipDuplicates: true,
    });
    if (count) await inviteNotice(other.id, userId, 'ami');
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

/** Ce qui attend une réponse du joueur : les badges le rappellent tant qu'il n'a pas répondu. */
/** Seules les invitations pas encore vues comptent : une demande vue reste à traiter, sans badge. */
export async function pendingInvites(userId: string) {
  const seen = await db.user.findUnique({
    where: { id: userId },
    select: { friendsSeenAt: true, clansSeenAt: true },
  });
  const [friends, clans] = await Promise.all([
    db.friendship.count({
      where: {
        addresseeId: userId,
        accepted: false,
        createdAt: { gt: seen?.friendsSeenAt ?? new Date(0) },
      },
    }),
    db.clanInvite.count({
      where: { userId, createdAt: { gt: seen?.clansSeenAt ?? new Date(0) } },
    }),
  ]);
  // Un nom retiré reste signalé au chef tant qu'il n'en a pas choisi un autre.
  const rename = await db.clanMember.count({
    where: { userId, owner: true, clan: { flaggedName: { not: null } } },
  });
  return { friends, clans: clans + rename };
}

/** La date d'une invitation vient de la base : son horloge peut avoir quelques millisecondes d'avance. */
export async function markInvitesSeen(userId: string, kind: 'friends' | 'clans') {
  const friends = kind === 'friends';
  const { _max: latest } = friends
    ? await db.friendship.aggregate({
        where: { addresseeId: userId, accepted: false },
        _max: { createdAt: true },
      })
    : await db.clanInvite.aggregate({ where: { userId }, _max: { createdAt: true } });
  const seenAt = new Date(Math.max(Date.now(), latest.createdAt?.getTime() ?? 0));
  await db.user.update({
    where: { id: userId },
    data: friends ? { friendsSeenAt: seenAt } : { clansSeenAt: seenAt },
  });
}

export async function friendIds(userId: string) {
  const links = await db.friendship.findMany({
    where: { accepted: true, OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return links.map((link) => (link.requesterId === userId ? link.addresseeId : link.requesterId));
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
