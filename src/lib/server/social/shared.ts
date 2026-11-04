import { Prisma } from '@prisma/client';
import { m } from '$lib/paraglide/messages';
import { db } from '../db';
import { notify } from '../push';
import { publicUser } from '../queries';
import { publishChat } from '../sync/events';

export const MESSAGES_SHOWN = 100;
export const PUSH_PREVIEW = 120;
export const MAX_CLAN_MEMBERS = 50;

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

export const personSelect = { id: true, ...publicUser } satisfies Prisma.UserSelect;

/** Un même couple de joueurs n'a qu'une discussion, quel que soit celui qui l'ouvre. */
export const directKey = (a: string, b: string) => [a, b].toSorted().join(':');

export const pair = (a: string, b: string) => [
  { requesterId: a, addresseeId: b },
  { requesterId: b, addresseeId: a },
];

export const isBlocked = async (a: string, b: string) =>
  (await db.block.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  })) > 0;

export async function inviteNotice(userId: string, fromId: string, type: 'ami' | 'clan') {
  const { displayName: name } = await db.user.findUniqueOrThrow({
    where: { id: fromId },
    select: { displayName: true },
  });
  publishChat(userId, { type: 'invite', from: name, invite: type });
  notify(userId, 'invite', `${type}:${fromId}`, (locale) =>
    type === 'ami'
      ? { title: name, body: m.push_friend_request({}, { locale }), url: '/amis' }
      : { title: name, body: m.push_clan_invite({}, { locale }), url: '/clan' },
  );
}
