import { m } from '#lib/paraglide/messages';
import { checkClanAchievements } from '../clan-achievements';
import { db } from '../db';
import { notify } from '../push';
import { acceptClanInvite } from './clans';
import { MAX_CLAN_MEMBERS, personSelect, type SocialFailure } from './shared';

/**
 * Une demande d'adhésion se passe d'amitié : elle arrive chez le chef et les officiers, qui
 * acceptent ou refusent.
 */
export async function requestToJoinClan(
  userId: string,
  clanId: string,
): Promise<SocialFailure | null> {
  const clan = await db.clan.findUnique({
    where: { id: clanId },
    select: {
      name: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!clan) return 'not_found';
  if (await db.clanMember.count({ where: { userId } })) return 'in_clan';
  if (clan.members.length >= MAX_CLAN_MEMBERS) return 'clan_full';

  // Une invitation du même clan attend déjà : la demande vaut acceptation, sans attendre.
  const invited = await db.clanInvite.count({ where: { clanId, userId } });
  if (invited) return acceptClanInvite(userId, clanId);

  await db.clanRequest.createMany({ data: [{ clanId, userId }], skipDuplicates: true });

  const { displayName: name } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true },
  });
  for (const member of clan.members) {
    if (member.role === 'MEMBER') continue;
    notify(member.userId, 'digest', `clan-demande:${clanId}:${userId}`, (locale) => ({
      title: m.clan_request_push_title({}, { locale }),
      body: m.clan_request_push_body({ name, clan: clan.name }, { locale }),
      url: '/clan',
    }));
  }
  return null;
}

/** Le chef et les officiers acceptent une demande de leur clan. */
export async function acceptClanRequest(
  userId: string,
  memberId: string,
): Promise<SocialFailure | null> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (!membership || membership.role === 'MEMBER') return 'officer_only';
  const request = await db.clanRequest.findUnique({
    where: { clanId_userId: { clanId: membership.clanId, userId: memberId } },
  });
  if (!request) return 'not_found';
  if (await db.clanMember.count({ where: { userId: memberId } })) return 'in_clan';
  if ((await db.clanMember.count({ where: { clanId: membership.clanId } })) >= MAX_CLAN_MEMBERS)
    return 'clan_full';

  const conversation = await db.conversation.findUniqueOrThrow({
    where: { clanId: membership.clanId },
    select: { id: true },
  });
  await db.$transaction([
    // Le joueur entre ici : ses autres demandes et invitations n'ont plus lieu d'être.
    db.clanRequest.deleteMany({ where: { userId: memberId } }),
    db.clanInvite.deleteMany({ where: { userId: memberId } }),
    db.clanMember.create({ data: { clanId: membership.clanId, userId: memberId } }),
    db.conversationMember.create({ data: { conversationId: conversation.id, userId: memberId } }),
  ]);
  await checkClanAchievements(membership.clanId);
  return null;
}

export async function declineClanRequest(userId: string, memberId: string) {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (!membership || membership.role === 'MEMBER') return 'officer_only';
  await db.clanRequest.deleteMany({
    where: { clanId: membership.clanId, userId: memberId },
  });
  return null;
}

/** Les demandes du clan que je gère : rien pour un simple membre. */
export async function clanRequests(userId: string) {
  const membership = await db.clanMember.findUnique({
    where: { userId },
    select: { clanId: true, role: true },
  });
  if (!membership || membership.role === 'MEMBER') return [];
  return db.clanRequest.findMany({
    where: { clanId: membership.clanId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, user: { select: personSelect } },
  });
}
