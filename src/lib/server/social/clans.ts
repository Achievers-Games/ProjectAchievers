import { Prisma, type PrismaClient } from '#prisma';
import { m } from '#lib/paraglide/messages';
import { isProfane } from '#lib/profanity';
import { slugify } from '#lib/slug';
import { checkClanAchievements } from '../clan-achievements';
import { clanImageUrl } from '../clan-image';
import { randomToken } from '../crypto';
import { db } from '../db';
import { TIER_POINTS } from '../queries/shared';
import { notify } from '../push';
import { relationWith } from './friends';
import { MAX_CLAN_MEMBERS, inviteNotice, personSelect, type SocialFailure } from './shared';

export async function clanMateIds(userId: string) {
  const membership = await db.clanMember.findUnique({
    where: { userId },
    select: { clan: { select: { members: { select: { userId: true } } } } },
  });
  return (
    membership?.clan.members.map((member) => member.userId).filter((id) => id !== userId) ?? []
  );
}

export async function myClan(userId: string) {
  const membership = await db.clanMember.findUnique({
    where: { userId },
    select: {
      role: true,
      clan: {
        select: {
          id: true,
          name: true,
          slug: true,
          flaggedName: true,
          imageAt: true,
          imagePending: true,
          frame: true,
          conversation: { select: { id: true } },
          members: {
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
            select: { role: true, user: { select: personSelect } },
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
    const clan = await db.clan.create({
      data: {
        name,
        slug: slugify(name) || `clan-${randomToken(6).toLowerCase()}`,
        members: { create: { userId, role: 'OWNER' } },
        conversation: { create: { members: { create: { userId } } } },
      },
      select: { id: true },
    });
    // Le clan hérite tout de suite de l'historique de son fondateur.
    await checkClanAchievements(clan.id);
    return null;
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      return 'name_taken';
    }
    throw cause;
  }
}

/** Le chef donne un nouveau nom au clan, et lève ainsi une demande de la modération. */
export async function renameClan(userId: string, name: string): Promise<SocialFailure | null> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (membership?.role !== 'OWNER') return 'owner_only';
  try {
    await db.clan.update({
      where: { id: membership.clanId },
      data: {
        name,
        slug: slugify(name) || `clan-${randomToken(6).toLowerCase()}`,
        flaggedName: null,
      },
      select: { id: true },
    });
    return null;
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      return 'name_taken';
    }
    throw cause;
  }
}

/**
 * Retire un nom contraire aux règles : le clan prend aussitôt un nom neutre,
 * et son chef est prévenu qu'il doit en choisir un autre.
 */
export async function flagClanName(clanId: string) {
  const clan = await db.clan.findUnique({
    where: { id: clanId },
    select: { name: true, flaggedName: true, members: { where: { role: 'OWNER' } } },
  });
  if (!clan || clan.flaggedName) return false;
  const token = randomToken(6).toLowerCase();
  await db.clan.update({
    where: { id: clanId },
    data: { name: `Clan #${token}`, slug: `clan-${token}`, flaggedName: clan.name },
    select: { id: true },
  });
  for (const owner of clan.members) {
    notify(owner.userId, 'digest', `clan-nom:${clanId}`, (locale) => ({
      title: m.clan_rename_push_title({}, { locale }),
      body: m.clan_rename_push_body({ name: clan.name }, { locale }),
      url: '/clan',
    }));
  }
  return true;
}

/** Les noms créés avant qu'un mot entre dans le filtre : ils sont retirés au balayage suivant. */
export async function flagProfaneClans() {
  const clans = await db.clan.findMany({
    where: { flaggedName: null },
    select: { id: true, name: true },
  });
  let flagged = 0;
  for (const clan of clans) {
    if (isProfane(clan.name) && (await flagClanName(clan.id))) flagged++;
  }
  return flagged;
}

/** Le chef et ses officiers invitent leurs amis ; personne n'entre sans avoir accepté. */
export async function inviteToClan(
  userId: string,
  friendId: string,
): Promise<SocialFailure | null> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (!membership || membership.role === 'MEMBER') return 'officer_only';
  if (await db.clanMember.count({ where: { userId: friendId } })) return 'in_clan';
  if ((await db.clanMember.count({ where: { clanId: membership.clanId } })) >= MAX_CLAN_MEMBERS)
    return 'clan_full';
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
    db.clanRequest.deleteMany({ where: { userId } }),
    db.clanMember.create({ data: { clanId, userId } }),
    db.conversationMember.create({ data: { conversationId: conversation.id, userId } }),
  ]);
  // Un nouveau membre peut faire franchir un palier au clan : il le partage alors avec lui.
  await checkClanAchievements(clanId);
  return null;
}

export async function declineClanInvite(userId: string, clanId: string) {
  await db.clanInvite.deleteMany({ where: { clanId, userId } });
}

/** Le clan survit au départ de son chef : un officier, sinon le plus ancien membre, prend sa place. */
export async function leaveClan(
  userId: string,
  client: Pick<PrismaClient, 'clan' | 'clanMember' | 'conversationMember'> = db,
) {
  const membership = await client.clanMember.findUnique({
    where: { userId },
    select: { clanId: true, role: true, clan: { select: { conversation: true } } },
  });
  if (!membership) return;
  const { clanId, role, clan } = membership;

  await client.clanMember.delete({ where: { userId } });
  if (clan.conversation) {
    await client.conversationMember.deleteMany({
      where: { conversationId: clan.conversation.id, userId },
    });
  }
  // L'ordre de l'énumération place le chef puis les officiers avant les membres.
  const next = await client.clanMember.findFirst({
    where: { clanId },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
  if (!next) await client.clan.delete({ where: { id: clanId } });
  else if (role === 'OWNER') {
    await client.clanMember.update({ where: { userId: next.userId }, data: { role: 'OWNER' } });
  }
}

const publicMembers = { user: { isPublic: true } };

/**
 * Les clans classés aux points de collection cumulés de leurs membres publics. Une carte
 * compte comme au classement des collectionneurs : une par famille, seulement si terminée.
 */
export async function listClans() {
  const rows = await db.$queryRaw<
    {
      id: string;
      name: string;
      slug: string;
      imageAt: Date | null;
      imagePending: boolean;
      frame: string | null;
      members: bigint;
      total: bigint;
      points: bigint;
    }[]
  >`
    WITH cards AS (
      SELECT ug."userId", COALESCE(g.tier, 1) AS tier
      FROM "UserGame" ug
      JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug.completion >= 100 AND NOT ug.hidden
      GROUP BY ug."userId", COALESCE(g."familyKey", g.id), COALESCE(g.tier, 1)
    ), scores AS (
      SELECT "userId",
             (count(*) FILTER (WHERE tier = 1) * ${TIER_POINTS[0]}
               + count(*) FILTER (WHERE tier = 2) * ${TIER_POINTS[1]}
               + count(*) FILTER (WHERE tier = 3) * ${TIER_POINTS[2]}
               + count(*) FILTER (WHERE tier = 4) * ${TIER_POINTS[3]}
               + count(*) FILTER (WHERE tier = 5) * ${TIER_POINTS[4]}
               + count(*) FILTER (WHERE tier = 6) * ${TIER_POINTS[5]})::bigint AS points
      FROM cards
      GROUP BY "userId"
    )
    SELECT c.id, c.name, c.slug, c."imageAt", c."imagePending", c.frame,
      count(DISTINCT u.id) AS members,
      count(DISTINCT cm."userId") AS total,
      COALESCE(sum(CASE WHEN u.id IS NOT NULL THEN COALESCE(s.points, 0) ELSE 0 END), 0)::bigint
        AS points
    FROM "Clan" c
    LEFT JOIN "ClanMember" cm ON cm."clanId" = c.id
    LEFT JOIN "User" u ON u.id = cm."userId" AND u."isPublic"
    LEFT JOIN scores s ON s."userId" = cm."userId"
    GROUP BY c.id
    ORDER BY points DESC, c.name`;
  return rows.map(({ imageAt, imagePending, ...row }) => ({
    ...row,
    image: clanImageUrl({ slug: row.slug, imageAt, imagePending }),
    members: Number(row.members),
    total: Number(row.total),
    points: Number(row.points),
    open: Number(row.total) < MAX_CLAN_MEMBERS,
  }));
}

/** Page publique : le récapitulatif d'un clan, sans les profils privés. */
export async function clanPage(slug: string) {
  const clan = await db.clan.findUnique({
    where: { slug },
    select: {
      name: true,
      slug: true,
      createdAt: true,
      imageAt: true,
      imagePending: true,
      frame: true,
      members: {
        where: publicMembers,
        orderBy: { joinedAt: 'asc' },
        select: { role: true, user: { select: personSelect } },
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
    .map(({ role, user: { id, ...user } }) => ({
      role,
      user,
      achievements: byUser.get(id) ?? 0,
    }))
    .sort((a, b) => b.achievements - a.achievements);
  return {
    name: clan.name,
    createdAt: clan.createdAt,
    image: clanImageUrl(clan),
    frame: clan.frame,
    members,
    achievements: members.reduce((sum, member) => sum + member.achievements, 0),
  };
}

/**
 * Un officier exclut les membres, le chef exclut aussi les officiers. Personne n'exclut le
 * chef, et on ne s'exclut pas soi-même : on quitte son clan.
 */
export async function kickFromClan(
  userId: string,
  memberId: string,
): Promise<SocialFailure | null> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (!membership || membership.role === 'MEMBER') return 'officer_only';
  if (memberId === userId) return 'self';
  const target = await db.clanMember.findUnique({ where: { userId: memberId } });
  if (!target || target.clanId !== membership.clanId) return 'not_found';
  if (target.role === 'OWNER') return 'owner_only';
  if (membership.role === 'OFFICER' && target.role === 'OFFICER') return 'officer_only';
  await leaveClan(memberId);
  return null;
}

/** Seul le chef nomme et rétrograde les officiers ; jamais lui-même. */
export async function setClanRole(
  userId: string,
  memberId: string,
  role: 'OFFICER' | 'MEMBER',
): Promise<SocialFailure | null> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (membership?.role !== 'OWNER') return 'owner_only';
  if (memberId === userId) return 'self';
  const target = await db.clanMember.findUnique({ where: { userId: memberId } });
  if (!target || target.clanId !== membership.clanId) return 'not_found';
  if (target.role === 'OWNER') return 'owner_only';
  await db.clanMember.update({ where: { userId: memberId }, data: { role } });
  return null;
}
