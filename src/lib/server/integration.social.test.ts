// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { activityFeed, hasRecentFeat, highlights, leaderboard } from './queries';
import { resolveIdentity } from './accounts';
import { db } from './db';
import { mergeUsers } from './merge';
import { markActive, subscribersToNotify, usersWhoLeft } from './push';
import {
  acceptClanInvite,
  acceptFriend,
  blockUser,
  clanPage,
  createClan,
  flagClanName,
  flagProfaneClans,
  inviteToClan,
  leaveClan,
  markInvitesSeen,
  openDirect,
  pendingInvites,
  readConversation,
  relationWith,
  renameClan,
  reportMessage,
  requestFriend,
  sendMessage,
  unreadCount,
} from './social';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

describe('amis, clans et discussions', () => {
  async function players() {
    const player = async () => {
      const result = await resolveIdentity(identity(), null);
      if (!result.ok) throw new Error('compte non créé');
      return db.user.findUniqueOrThrow({ where: { id: result.userId } });
    };
    return [await player(), await player()] as const;
  }

  it('n’ouvre une discussion qu’entre amis, et le blocage la coupe', async () => {
    const [a, b] = await players();
    expect(await openDirect(a.id, b.id)).toBeNull();

    await requestFriend(a.id, b.handle);
    expect(await relationWith(a.id, b.id)).toBe('sent');
    expect(await openDirect(a.id, b.id)).toBeNull();
    await acceptFriend(b.id, a.id);

    const id = await openDirect(a.id, b.id);
    expect(id).toBeTruthy();
    expect(await openDirect(b.id, a.id)).toBe(id);

    expect(await sendMessage(a.id, id as string, 'Salut')).toMatchObject({ content: 'Salut' });
    expect(await unreadCount(b.id)).toBe(1);
    await readConversation(b.id, id as string);
    expect(await unreadCount(b.id)).toBe(0);

    await blockUser(b.id, a.id);
    expect(await sendMessage(a.id, id as string, 'Encore')).toBe('not_friends');
    expect(await requestFriend(a.id, b.handle)).toBe('not_found');
  });

  it('retire du badge une demande vue, sans la refuser', async () => {
    const [a, b] = await players();
    await requestFriend(a.id, b.handle);
    expect((await pendingInvites(b.id)).friends).toBe(1);

    await markInvitesSeen(b.id, 'friends');
    expect((await pendingInvites(b.id)).friends).toBe(0);
    expect(await relationWith(b.id, a.id)).toBe('received');
  });

  it('garde les discussions fermées aux autres joueurs', async () => {
    const [a, b] = await players();
    const [intruder] = await players();
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    const id = (await openDirect(a.id, b.id)) as string;
    const message = await sendMessage(a.id, id, 'Privé');
    if (typeof message === 'string') throw new Error('message refusé');

    expect(await readConversation(intruder.id, id)).toBeNull();
    expect(await sendMessage(intruder.id, id, 'Coucou')).toBe('not_found');
    expect(await reportMessage(intruder.id, message.id, 'Rien')).toBe(false);
    expect(await reportMessage(b.id, message.id, 'Insulte')).toBe(true);
  });

  const pendingMerge = async (sourceId: string, targetId: string) => {
    const provider = 'DISCORD' as const;
    const providerUserId = `${PREFIX}-${Math.random()}`;
    await db.linkedAccount.create({
      data: { userId: sourceId, provider, providerUserId, displayName: 'Preuve' },
    });
    await db.linkedAccount.deleteMany({
      where: { userId: { in: [sourceId, targetId] }, provider: { not: provider } },
    });
    return { sourceId, targetId, provider, providerUserId };
  };

  it('réunit les discussions avec un même ami à la fusion', async () => {
    const [source, target] = await players();
    const [friend] = await players();
    for (const user of [source, target]) {
      await requestFriend(user.id, friend.handle);
      await acceptFriend(friend.id, user.id);
    }
    const fromSource = (await openDirect(source.id, friend.id)) as string;
    const fromTarget = (await openDirect(target.id, friend.id)) as string;
    await sendMessage(source.id, fromSource, 'Ancien profil');
    await sendMessage(target.id, fromTarget, 'Profil gardé');

    expect(await mergeUsers(await pendingMerge(source.id, target.id))).toBeNull();

    const conversation = await readConversation(target.id, fromTarget);
    expect(conversation?.messages.map((message) => message.content)).toEqual([
      'Ancien profil',
      'Profil gardé',
    ]);
    expect(await openDirect(target.id, friend.id)).toBe(fromTarget);
    expect(await relationWith(target.id, friend.id)).toBe('friends');
  });

  it('demande quel clan garder, puis garde celui choisi', async () => {
    const [source, target] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    await createClan(source.id, `${name}a`);
    await createClan(target.id, `${name}b`);
    const merge = await pendingMerge(source.id, target.id);

    expect(await mergeUsers(merge)).toBe('clan_choice');
    expect(await mergeUsers(merge, 'source')).toBeNull();

    const clan = await db.clanMember.findUnique({
      where: { userId: target.id },
      select: { owner: true, clan: { select: { name: true } } },
    });
    expect(clan).toEqual({ owner: true, clan: { name: `${name}a` } });
    expect(await db.clan.findUnique({ where: { name: `${name}b` } })).toBeNull();
  });

  it('additionne les succès des membres publics d’un clan', async () => {
    const [a, b] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    await createClan(a.id, name);
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    const { id: clanId, slug } = await db.clan.findUniqueOrThrow({ where: { name } });
    await inviteToClan(a.id, b.id);
    await acceptClanInvite(b.id, clanId);
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} clan`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const achievement = await db.achievement.create({
      data: { gameId: game.id, platformAchievementId: '0', name: 'A' },
    });
    for (const user of [a, b]) {
      await db.userAchievement.create({
        data: { userId: user.id, achievementId: achievement.id, unlockedAt: new Date() },
      });
    }

    expect((await clanPage(slug))?.achievements).toBe(2);
    await db.user.update({ where: { id: b.id }, data: { isPublic: false } });
    const page = await clanPage(slug);
    expect(page?.achievements).toBe(1);
    expect(page?.members).toHaveLength(1);
  });

  it('transmet le clan au plus ancien membre, puis le supprime quand il est vide', async () => {
    const [a, b] = await players();
    expect(await inviteToClan(a.id, b.id)).toBe('owner_only');
    const name = `${PREFIX} ${Math.random()}`;
    expect(await createClan(a.id, name)).toBeNull();
    expect(await createClan(a.id, `${name}2`)).toBe('in_clan');

    expect(await inviteToClan(a.id, b.id)).toBe('not_friends');
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    expect(await inviteToClan(a.id, b.id)).toBeNull();
    const clan = await db.clan.findUniqueOrThrow({ where: { name } });
    expect(await acceptClanInvite(b.id, clan.id)).toBeNull();

    await leaveClan(a.id);
    expect(await db.clanMember.findUnique({ where: { userId: b.id } })).toMatchObject({
      owner: true,
    });
    await leaveClan(b.id);
    expect(await db.clan.findUnique({ where: { name } })).toBeNull();
  });

  it('accorde un palier de clan dès l’arrivée du membre qui le fait franchir', async () => {
    const [a, b] = await players();
    const [c] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    expect(await createClan(a.id, name)).toBeNull();
    const { id } = await db.clan.findUniqueOrThrow({ where: { name } });
    for (const friend of [b, c]) {
      await requestFriend(a.id, friend.handle);
      await acceptFriend(friend.id, a.id);
      await inviteToClan(a.id, friend.id);
      expect(await acceptClanInvite(friend.id, id)).toBeNull();
    }
    expect(await db.clanUnlock.count({ where: { clanId: id, code: 'band_3' } })).toBe(1);
    for (const member of [a, b, c]) {
      expect(await db.siteUnlock.count({ where: { userId: member.id, code: 'band_3' } })).toBe(1);
    }
    for (const member of [c, b, a]) await leaveClan(member.id);
  });

  it('retire un nom grossier et laisse le chef en choisir un autre', async () => {
    const [a, b] = await players();
    const name = `Zgeg ${Math.random().toString(36).slice(2, 8)}`;
    expect(await createClan(a.id, name)).toBeNull();
    const { id } = await db.clan.findUniqueOrThrow({ where: { name } });
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    await inviteToClan(a.id, b.id);
    await acceptClanInvite(b.id, id);

    expect(await flagProfaneClans()).toBeGreaterThanOrEqual(1);
    const flagged = await db.clan.findUniqueOrThrow({ where: { id } });
    expect(flagged).toMatchObject({ flaggedName: name });
    expect(flagged.name).toMatch(/^Clan #/);
    expect(await flagClanName(id)).toBe(false);
    expect((await pendingInvites(a.id)).clans).toBeGreaterThanOrEqual(1);

    expect(await renameClan(b.id, `${PREFIX} propre`)).toBe('owner_only');
    const fresh = `${PREFIX} ${Math.random()}`;
    expect(await renameClan(a.id, fresh)).toBeNull();
    expect(await db.clan.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: fresh,
      flaggedName: null,
    });
    await leaveClan(b.id);
    await leaveClan(a.id);
  });
});

describe('notifications', () => {
  async function subscribed() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    const session = await db.session.create({
      data: {
        id: `${PREFIX}-${Math.random()}`,
        userId: result.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await db.pushSubscription.create({
      data: {
        userId: result.userId,
        sessionId: session.id,
        endpoint: `https://push.exemple/${Math.random()}`,
        p256dh: 'p',
        auth: 'a',
        locale: 'fr',
      },
    });
    return { userId: result.userId, session };
  }

  it('ne sonne qu’une fois par discussion', async () => {
    const { userId } = await subscribed();
    expect(await subscribersToNotify(userId, 'message', 'c1')).toHaveLength(1);
    expect(await subscribersToNotify(userId, 'message', 'c1')).toHaveLength(0);
    expect(await subscribersToNotify(userId, 'message', 'c2')).toHaveLength(1);
  });

  it('se tait pendant que le joueur regarde le site', async () => {
    const { userId } = await subscribed();
    markActive(userId);
    expect(await subscribersToNotify(userId, 'invite', 'a')).toHaveLength(0);
  });

  it('prépare un résumé une fois le joueur parti, et une seule fois', async () => {
    const { userId } = await subscribed();
    markActive(userId);
    await subscribersToNotify(userId, 'message', 'c1');
    expect(usersWhoLeft()).not.toContain(userId);

    markActive(userId, Date.now() - 120_000);
    expect(usersWhoLeft()).toContain(userId);
    expect(usersWhoLeft()).not.toContain(userId);
    expect(await subscribersToNotify(userId, 'digest', 'resume')).toHaveLength(1);
  });

  it('respecte les préférences et la limite horaire', async () => {
    const { userId } = await subscribed();
    await db.user.update({ where: { id: userId }, data: { pushInvites: false } });
    expect(await subscribersToNotify(userId, 'invite', 'a')).toHaveLength(0);

    const sent = [];
    for (let index = 0; index < 12; index++) {
      sent.push((await subscribersToNotify(userId, 'event', String(index))).length);
    }
    expect(sent.reduce((sum, count) => sum + count, 0)).toBe(8);
  });

  it('s’arrête quand la session se ferme', async () => {
    const { userId, session } = await subscribed();
    await db.session.delete({ where: { id: session.id } });
    expect(await subscribersToNotify(userId, 'event', 'a')).toHaveLength(0);
  });
});

describe('fil de la communauté', () => {
  it('classe uniquement les joueurs demandés', async () => {
    const rows = await db.user.findMany({
      where: { handle: { in: ['demo', 'lea'] } },
      select: { id: true, handle: true },
    });
    const lea = rows.find((row) => row.handle === 'lea')?.id as string;
    const ranking = await leaderboard('tout', 20, [lea]);
    expect(ranking.map((row) => row.handle)).toEqual(['lea']);
    expect(await leaderboard('tout', 20, [])).toEqual([]);
  });

  it('signale un exploit récent, pas un succès banal', async () => {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('compte non créé');
    const game = await db.game.create({
      data: {
        platform: 'PSN',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} exploit`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const add = async (id: string, globalRarity: number) => {
      const achievement = await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: id, name: id, globalRarity },
      });
      await db.userAchievement.create({
        data: { userId: created.userId, achievementId: achievement.id, unlockedAt: new Date() },
      });
    };
    const since = new Date(Date.now() - 60_000);
    await add('banal', 40);
    expect(await hasRecentFeat(created.userId, game.id, since)).toBe(false);
    await add('rare', 0.5);
    expect(await hasRecentFeat(created.userId, game.id, since)).toBe(true);
  });

  it('annonce chaque niveau d’une carte, une fois', async () => {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('compte non créé');
    const family = `${PREFIX}-${Math.random()}`;
    const finish = async (platform: 'STEAM' | 'PSN', suffix: string, date: string) => {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} niveaux`,
          slug: `${PREFIX}-niveaux-${suffix}-${Math.random().toString(36).slice(2)}`,
          familyKey: family,
          contentCheckedAt: new Date(),
        },
      });
      await db.userGame.create({
        data: {
          userId: created.userId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 1,
          totalCount: 1,
          lastUnlockedAt: new Date(date),
        },
      });
    };
    await finish('STEAM', 'a', '2030-01-01T00:00:00Z');
    await finish('STEAM', 'b', '2030-01-02T00:00:00Z');
    await finish('PSN', 'c', '2030-01-03T00:00:00Z');

    const moments = (await highlights(false, 30)).flatMap((item) =>
      item.kind === 'card' && item.game.name === `${PREFIX} niveaux` ? [item.copies] : [],
    );
    expect(moments).toEqual([2, 1]);
  });

  it('ne garde dans le global que les exploits et les jeux terminés', async () => {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('compte non créé');
    const userId = created.userId;
    const game = await db.game.create({
      data: {
        platform: 'PSN',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} fil`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const add = async (name: string, globalRarity: number, trophyType: 'BRONZE' | 'PLATINUM') => {
      const achievement = await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: name, name, globalRarity, trophyType },
      });
      await db.userAchievement.create({
        data: { userId, achievementId: achievement.id, unlockedAt: new Date(Date.now() + 60_000) },
      });
    };
    await add(`${PREFIX}-banal`, 40, 'BRONZE');
    await add(`${PREFIX}-rare`, 0.5, 'BRONZE');
    await add(`${PREFIX}-platine`, 30, 'PLATINUM');

    const names = (await activityFeed(false, { feats: true, limit: 200 })).map(
      (row) => row.achievement.name,
    );
    expect(names).toContain(`${PREFIX}-rare`);
    expect(names).toContain(`${PREFIX}-platine`);
    expect(names).not.toContain(`${PREFIX}-banal`);

    expect(await activityFeed(false, { userIds: [] })).toEqual([]);
    expect(await activityFeed(false, { userIds: [userId] })).toHaveLength(3);
  });
});
