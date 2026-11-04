// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';

import { resolveIdentity } from './accounts';
import { db } from './db';
import { markNotificationsRead, notifications, unseenNotices } from './notifications';
import {
  acceptFriend,
  createClan,
  inviteToClan,
  openDirect,
  pendingInvites,
  requestFriend,
  sendMessage,
  unreadCount,
} from './social';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

async function player() {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  return db.user.findUniqueOrThrow({ where: { id: result.userId } });
}

/** Le joueur reçoit de tout : un ami qui écrit, deux invitations, un jeu terminé. */
async function busyPlayer() {
  const me = await player();
  const friend = await player();
  const stranger = await player();

  await requestFriend(friend.id, me.handle);
  await acceptFriend(me.id, friend.id);
  const conversationId = (await openDirect(friend.id, me.id)) as string;
  await sendMessage(friend.id, conversationId, 'Salut');

  await requestFriend(stranger.id, me.handle);
  await createClan(friend.id, `${PREFIX} clan ${Math.random().toString(36).slice(2, 8)}`);
  await inviteToClan(friend.id, me.id);

  const game = await upsertGame({
    platform: 'PSN',
    platformGameId: `${PREFIX}-${Math.random()}`,
    name: `${PREFIX} jeu`,
  });
  await saveAchievements(
    game.id,
    ['GOLD', 'GOLD'].map((trophyType, i) => ({
      platformAchievementId: String(i),
      name: `${PREFIX} T${i}`,
      description: '',
      hidden: false,
      trophyType: trophyType as 'GOLD',
    })),
  );
  await saveProgress(
    me.id,
    game.id,
    [0, 1].map((i) => ({ platformAchievementId: String(i), unlockedAt: new Date() })),
  );

  return { me, conversationId };
}

describe('centre de notifications', () => {
  it('mêle messages, invitations, succès et jeux terminés, du plus récent au plus ancien', async () => {
    const { me, conversationId } = await busyPlayer();
    const items = await notifications(me.id);

    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(['message', 'invite_friend', 'invite_clan', 'unlock', 'card']),
    );
    const times = items.map((item) => Date.parse(item.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(items.every((item) => item.unread)).toBe(true);

    const message = items.find((item) => item.kind === 'message');
    expect(message).toMatchObject({
      title: `${PREFIX} joueur`,
      detail: 'Salut',
      href: `/messages/${conversationId}`,
      count: 1,
    });
  });

  it('compte pour le badge les succès et jeux terminés, puis tout marquer comme lu vide tout', async () => {
    const { me, conversationId } = await busyPlayer();
    expect(await unseenNotices(me.id)).toBe(3);
    expect((await pendingInvites(me.id)).friends).toBe(1);

    await markNotificationsRead(me.id);

    expect(await unseenNotices(me.id)).toBe(0);
    expect(await unreadCount(me.id)).toBe(0);
    expect(await pendingInvites(me.id)).toEqual({ friends: 0, clans: 0 });
    const items = await notifications(me.id);
    expect(items.every((item) => !item.unread)).toBe(true);
    // La discussion et l'invitation restent dans la liste : elles sont lues, pas effacées.
    expect(items.map((item) => item.id)).toContain(`message:${conversationId}`);
  });

  it('garde les plus récentes quand la liste est bornée', async () => {
    const { me } = await busyPlayer();
    const [newest] = await notifications(me.id);
    expect(await notifications(me.id, 1)).toEqual([newest]);
  });
});
