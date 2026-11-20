import { db } from './db';
import { listConversations, markInvitesSeen, personSelect } from './social';
import type { Notice } from '#lib/notices';
import { m } from '#lib/paraglide/messages';

export type { Notice, NoticeKind } from '#lib/notices';

/** Au-delà, une notification n'apprend plus grand-chose : le panneau se lit d'un coup d'œil. */
const NOTICE_DAYS = 30;
const MESSAGE_NOTICES = 5;
const INVITE_NOTICES = 5;
const UNLOCK_NOTICES = 6;
const CARD_NOTICES = 3;

const DAY = 24 * 60 * 60 * 1000;

/** Un jeu dont un succès est arrivé sur le site après `after` : ce qui a pu le terminer. */
const completedSince = (userId: string, after: Date) => ({
  game: { achievements: { some: { unlocks: { some: { userId, createdAt: { gt: after } } } } } },
});

/** Le point de lecture d'un joueur, ou le début des temps s'il n'a jamais rien marqué. */
async function seenAt(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { friendsSeenAt: true, clansSeenAt: true, notificationsSeenAt: true, role: true },
  });
  const epoch = new Date(0);
  return {
    friends: user?.friendsSeenAt ?? epoch,
    clans: user?.clansSeenAt ?? epoch,
    notices: user?.notificationsSeenAt ?? epoch,
    moderator: user?.role === 'ADMIN' || user?.role === 'MODERATOR',
  };
}

const integrityNotices = (userId: string, moderator: boolean, after: Date) => ({
  OR: [
    { userId, openedAt: { gt: after } },
    ...(moderator ? [{ status: 'PENDING' as const, openedAt: { gt: after } }] : []),
  ],
});

/**
 * Ce qui est arrivé au joueur récemment : messages, invitations en attente, succès de
 * plateforme et jeux terminés. Tout vient des tables existantes, avec les marqueurs de
 * lecture du site : aucune notification n'est recopiée ailleurs.
 */
export async function notifications(userId: string, limit = 12): Promise<Notice[]> {
  const since = new Date(Date.now() - NOTICE_DAYS * DAY);
  const seen = await seenAt(userId);

  const [
    conversations,
    received,
    clanInvites,
    clanRequests,
    flaggedClans,
    unlocks,
    cards,
    reviews,
  ] = await Promise.all([
    listConversations(userId),
    db.friendship.findMany({
      where: { addresseeId: userId, accepted: false },
      orderBy: { createdAt: 'desc' },
      take: INVITE_NOTICES,
      select: { id: true, createdAt: true, requester: { select: personSelect } },
    }),
    db.clanInvite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: INVITE_NOTICES,
      select: { createdAt: true, clan: { select: { name: true, slug: true, imageAt: true } } },
    }),
    // Les demandes d'adhésion arrivent au chef et aux officiers du clan.
    db.clanRequest.findMany({
      where: { clan: { members: { some: { userId, role: { not: 'MEMBER' } } } } },
      orderBy: { createdAt: 'desc' },
      take: INVITE_NOTICES,
      select: {
        createdAt: true,
        clan: { select: { name: true } },
        user: { select: personSelect },
      },
    }),
    // Un nom retiré laisse une action en attente : le badge la compte déjà, le panneau doit la
    // montrer, sans quoi la cloche annonce une nouveauté introuvable.
    db.clanMember.findMany({
      where: { userId, role: 'OWNER', clan: { flaggedName: { not: null } } },
      select: { clan: { select: { id: true, flaggedName: true } } },
    }),
    // Classés à l'arrivée sur le site : un succès d'hier lu ce matin par la synchronisation
    // est une nouvelle d'aujourd'hui.
    db.userAchievement.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: UNLOCK_NOTICES,
      select: {
        unlockedAt: true,
        createdAt: true,
        achievement: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
            game: { select: { name: true, slug: true } },
          },
        },
      },
    }),
    db.userGame.findMany({
      where: {
        userId,
        hidden: false,
        completion: { gte: 100 },
        ...completedSince(userId, since),
      },
      orderBy: { lastUnlockedAt: 'desc' },
      take: CARD_NOTICES,
      select: {
        lastUnlockedAt: true,
        gameId: true,
        game: { select: { name: true, slug: true, headerUrl: true } },
      },
    }),
    db.steamIntegrityReview.findMany({
      where: integrityNotices(userId, seen.moderator, since),
      orderBy: { openedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        suspendedAt: true,
        openedAt: true,
        status: true,
        resetAt: true,
        game: { select: { name: true, slug: true } },
      },
    }),
  ]);

  const notices: Notice[] = [];
  for (const review of reviews) {
    const own = review.userId === userId;
    const at = review.openedAt;
    notices.push({
      id: `integrity:${review.id}`,
      kind: 'integrity',
      at: at.toISOString(),
      href: own
        ? `/jeux/${review.game.slug}?succes=hors-score`
        : `/moderation#steam-review-${review.id}`,
      title: own
        ? review.status === 'APPROVED'
          ? review.resetAt
            ? m.steam_status_player_unblocked({ game: review.game.name })
            : m.steam_review_player_approved({ game: review.game.name })
          : m.steam_review_player_notice({ game: review.game.name })
        : m.steam_review_mod_notice({ game: review.game.name }),
      detail: own
        ? review.status === 'APPROVED'
          ? null
          : review.suspendedAt
            ? review.status === 'REJECTED'
              ? m.steam_review_player_rejected()
              : m.steam_review_player_detail()
            : m.steam_review_unscored_detail()
        : null,
      unread: at > seen.notices,
    });
  }

  // listConversations trie déjà du plus récent au plus ancien ; une discussion encore vide
  // ne dit rien.
  for (const row of conversations.slice(0, MESSAGE_NOTICES)) {
    if (!row.at) continue;
    notices.push({
      id: `message:${row.id}`,
      kind: 'message',
      at: row.at.toISOString(),
      href: `/messages/${row.id}`,
      title: row.title,
      detail: row.preview || null,
      detailLocale: row.previewLocale,
      icon: row.person?.avatarUrl ?? null,
      unread: row.unread > 0,
      count: row.unread,
    });
  }

  for (const row of received) {
    notices.push({
      id: `friend:${row.id}`,
      kind: 'invite_friend',
      at: row.createdAt.toISOString(),
      href: '/amis',
      title: row.requester.displayName,
      icon: row.requester.avatarUrl,
      unread: row.createdAt > seen.friends,
    });
  }

  for (const row of clanInvites) {
    notices.push({
      id: `clan:${row.clan.slug}`,
      kind: 'invite_clan',
      at: row.createdAt.toISOString(),
      href: `/clans/${row.clan.slug}`,
      title: row.clan.name,
      icon: row.clan.imageAt
        ? `/clans/${row.clan.slug}/image?v=${row.clan.imageAt.getTime()}`
        : null,
      unread: row.createdAt > seen.clans,
    });
  }

  for (const row of clanRequests) {
    notices.push({
      id: `clan-request:${row.user.id}`,
      kind: 'clan_request',
      at: row.createdAt.toISOString(),
      href: '/clan',
      title: row.user.displayName,
      detail: row.clan.name,
      icon: row.user.avatarUrl,
      unread: row.createdAt > seen.clans,
    });
  }

  // Le nom retiré n'a pas de date propre : c'est l'état courant du clan, donc la nouvelle la plus
  // récente, et elle reste en tête tant que le chef n'a pas choisi un autre nom.
  for (const row of flaggedClans) {
    notices.push({
      id: `clan-rename:${row.clan.id}`,
      kind: 'clan_rename',
      at: new Date().toISOString(),
      href: '/clan',
      title: m.clan_rename_title(),
      detail: m.clan_rename_text({ name: row.clan.flaggedName ?? '' }),
      unread: true,
    });
  }

  for (const row of unlocks) {
    notices.push({
      id: `unlock:${row.achievement.id}`,
      kind: 'unlock',
      at: row.unlockedAt.toISOString(),
      href: `/jeux/${row.achievement.game.slug}`,
      title: row.achievement.name,
      detail: row.achievement.game.name,
      icon: row.achievement.iconUrl,
      unread: row.createdAt > seen.notices,
    });
  }

  // Le dernier succès arrivé sur chaque jeu terminé : c'est lui qui a fait tomber la carte.
  const arrivals = await Promise.all(
    cards.map((row) =>
      db.userAchievement.findFirst({
        where: { userId, achievement: { gameId: row.gameId } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ),
  );
  cards.forEach((row, index) => {
    const arrived = arrivals[index]?.createdAt;
    if (!row.lastUnlockedAt || !arrived) return;
    notices.push({
      id: `card:${row.game.slug}`,
      kind: 'card',
      at: row.lastUnlockedAt.toISOString(),
      href: `/jeux/${row.game.slug}`,
      title: row.game.name,
      icon: row.game.headerUrl,
      unread: arrived > seen.notices,
    });
  });

  // Messages et succès se mélangent : le panneau montre le plus récent en haut, sans doublon.
  const unique = new Map(notices.map((notice) => [notice.id, notice]));
  return [...unique.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/** Ce que le badge doit compter en plus des messages et des invitations déjà comptés ailleurs. */
export async function unseenNotices(userId: string) {
  const { notices: seen, moderator } = await seenAt(userId);
  const since = new Date(Date.now() - NOTICE_DAYS * DAY);
  const after = seen > since ? seen : since;
  const [unlocks, cards, reviews] = await Promise.all([
    db.userAchievement.count({ where: { userId, createdAt: { gt: after } } }),
    db.userGame.count({
      where: { userId, hidden: false, completion: { gte: 100 }, ...completedSince(userId, after) },
    }),
    db.steamIntegrityReview.count({ where: integrityNotices(userId, moderator, after) }),
  ]);
  return unlocks + cards + reviews;
}

/**
 * « Tout marquer comme lu » : premiers points de lecture, comme le fait déjà une visite de
 * la page des amis, plus le marqueur des succès et les discussions lues d'un coup.
 */
export async function markNotificationsRead(userId: string) {
  const now = new Date();
  await Promise.all([markInvitesSeen(userId, 'friends'), markInvitesSeen(userId, 'clans')]);

  // L'horloge de la base peut avancer sur celle du serveur : le point de lecture la suit.
  const { _max: last } = await db.userAchievement.aggregate({
    where: { userId },
    _max: { createdAt: true },
  });
  const seen = new Date(Math.max(now.getTime(), last.createdAt?.getTime() ?? 0));

  await Promise.all([
    db.user.update({ where: { id: userId }, data: { notificationsSeenAt: seen } }),
    db.conversationMember.updateMany({ where: { userId }, data: { lastReadAt: seen } }),
  ]);
}
