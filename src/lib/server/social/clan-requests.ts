import { m } from '#lib/paraglide/messages';
import { db } from '../db';
import { notify } from '../push';
import { acceptClanInvite, admitToClan } from './clans';
import { MAX_CLAN_MEMBERS, isBlocked, personSelect, type SocialFailure } from './shared';

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

  // Un joueur bloqué par le chef ou un officier (ou qui les a bloqués) ne leur écrit pas, même
  // par une demande d'adhésion.
  const managers = clan.members.filter((member) => member.role !== 'MEMBER');
  const blocked = await Promise.all(managers.map((member) => isBlocked(userId, member.userId)));
  if (blocked.some(Boolean)) return 'blocked';

  // Une invitation du même clan attend déjà : la demande vaut acceptation, sans attendre.
  const invited = await db.clanInvite.count({ where: { clanId, userId } });
  if (invited) return acceptClanInvite(userId, clanId);

  await db.clanRequest.createMany({ data: [{ clanId, userId }], skipDuplicates: true });

  const { displayName: name } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true },
  });
  for (const member of managers) {
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
  return admitToClan(membership.clanId, memberId);
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
