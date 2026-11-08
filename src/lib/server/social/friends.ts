import type { Prisma } from '#prisma';
import { db } from '../db';
import {
  inviteNotice,
  isBlocked,
  MAX_FRIENDS,
  pair,
  personSelect,
  type Relation,
  type SocialFailure,
} from './shared';

type Transaction = Prisma.TransactionClient;

/** Les amitiés acceptées d'un joueur, dans les deux sens de la ligne. */
const accepted = (userId: string) => ({
  accepted: true,
  OR: [{ requesterId: userId }, { addresseeId: userId }],
});

/**
 * Les deux verrous sont pris dans l'ordre des identifiants : deux opérations croisées
 * (demande contre acceptation, deux demandes simultanées) se sérialisent sans s'attendre en rond.
 */
async function lockPair(tx: Transaction, a: string, b: string) {
  const [first, second] = [a, b].toSorted();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${first})::bigint)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${second})::bigint)`;
}

const countFriends = (tx: Transaction, userId: string) =>
  tx.friendship.count({ where: accepted(userId) });

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

  const result = await db.$transaction(async (tx) => {
    await lockPair(tx, userId, other.id);
    // Le plafond ne compte que les amitiés acceptées : une demande en attente ne prend pas de place.
    if ((await countFriends(tx, userId)) >= MAX_FRIENDS) return 'friends_full' as const;

    const link = await tx.friendship.findFirst({ where: { OR: pair(userId, other.id) } });
    if (!link) {
      const { count } = await tx.friendship.createMany({
        data: [{ requesterId: userId, addresseeId: other.id }],
        skipDuplicates: true,
      });
      return count ? ('invited' as const) : null;
    }
    if (!link.accepted && link.addresseeId === userId) {
      // Une demande reçue devient une amitié : le plafond de l'autre compte aussi.
      if ((await countFriends(tx, other.id)) >= MAX_FRIENDS) return 'friends_full' as const;
      await tx.friendship.update({ where: { id: link.id }, data: { accepted: true } });
      return 'accepted' as const;
    }
    return null;
  });

  if (result === 'invited') await inviteNotice(other.id, userId, 'ami');
  return result === 'friends_full' ? 'friends_full' : null;
}

/**
 * La demande reste en attente quand l'un des deux est au plafond : retirer un ami libère la
 * place, et la demande peut alors être acceptée.
 */
export async function acceptFriend(userId: string, otherId: string): Promise<SocialFailure | null> {
  return db.$transaction(async (tx) => {
    await lockPair(tx, userId, otherId);
    const link = await tx.friendship.findFirst({
      where: { requesterId: otherId, addresseeId: userId, accepted: false },
    });
    if (!link) return null;
    const [mine, theirs] = await Promise.all([countFriends(tx, userId), countFriends(tx, otherId)]);
    if (mine >= MAX_FRIENDS || theirs >= MAX_FRIENDS) return 'friends_full';
    await tx.friendship.update({ where: { id: link.id }, data: { accepted: true } });
    return null;
  });
}

/** Le nombre d'amitiés acceptées, pour l'affichage « n / 30 amis ». */
export async function friendCount(userId: string) {
  return db.friendship.count({ where: accepted(userId) });
}

/** Les amis triés par nom : le sélecteur de comparaison n'a besoin que de ceux-là. */
export async function friendList(userId: string) {
  const links = await db.friendship.findMany({
    where: accepted(userId),
    select: {
      requesterId: true,
      requester: { select: personSelect },
      addressee: { select: personSelect },
    },
  });
  return links
    .map((link) => (link.requesterId === userId ? link.addressee : link.requester))
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
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
  const since = seen?.clansSeenAt ?? new Date(0);
  const [friends, clans, requests] = await Promise.all([
    db.friendship.count({
      where: {
        addresseeId: userId,
        accepted: false,
        createdAt: { gt: seen?.friendsSeenAt ?? new Date(0) },
      },
    }),
    db.clanInvite.count({ where: { userId, createdAt: { gt: since } } }),
    // Les demandes d'adhésion arrivent au chef et aux officiers, pas aux simples membres.
    db.clanRequest.count({
      where: {
        createdAt: { gt: since },
        clan: { members: { some: { userId, role: { not: 'MEMBER' } } } },
      },
    }),
  ]);
  // Un nom retiré reste signalé au chef tant qu'il n'en a pas choisi un autre.
  const rename = await db.clanMember.count({
    where: { userId, role: 'OWNER', clan: { flaggedName: { not: null } } },
  });
  return { friends, clans: clans + requests + rename };
}

/** La date d'une invitation vient de la base : son horloge peut avoir quelques millisecondes d'avance. */
export async function markInvitesSeen(userId: string, kind: 'friends' | 'clans') {
  const friends = kind === 'friends';
  const dates = friends
    ? [
        (
          await db.friendship.aggregate({
            where: { addresseeId: userId, accepted: false },
            _max: { createdAt: true },
          })
        )._max.createdAt,
      ]
    : await Promise.all([
        db.clanInvite.aggregate({ where: { userId }, _max: { createdAt: true } }),
        // Les demandes reçues par le clan que je gère partagent le même marqueur de lecture.
        db.clanRequest.aggregate({
          where: { clan: { members: { some: { userId, role: { not: 'MEMBER' } } } } },
          _max: { createdAt: true },
        }),
      ]).then((rows) => rows.map((row) => row._max.createdAt));
  const seenAt = new Date(Math.max(Date.now(), ...dates.map((date) => date?.getTime() ?? 0)));
  await db.user.update({
    where: { id: userId },
    data: friends ? { friendsSeenAt: seenAt } : { clansSeenAt: seenAt },
  });
}

export async function friendIds(userId: string) {
  const links = await db.friendship.findMany({
    where: accepted(userId),
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
