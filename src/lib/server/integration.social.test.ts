// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import {
  activityFeed,
  friendsPlaying,
  hasRecentFeat,
  highlights,
  leaderboard,
  userProfile,
} from './queries';
import { resolveIdentity } from './accounts';
import { db } from './db';
import { mergeUsers } from './merge';
import { notifications } from './notifications';
import { markActive, subscribersToNotify, usersWhoLeft } from './push';
import {
  acceptClanInvite,
  acceptClanRequest,
  acceptFriend,
  blockUser,
  clanPage,
  clanRequests,
  createClan,
  declineClanRequest,
  flagClanName,
  flagProfaneClans,
  friendCount,
  inviteToClan,
  kickFromClan,
  leaveClan,
  listClans,
  markRead,
  markInvitesSeen,
  openDirect,
  pendingInvites,
  readConversation,
  relationWith,
  renameClan,
  reportMessage,
  requestFriend,
  requestToJoinClan,
  sendMessage,
  setClanRole,
  unreadCount,
} from './social';
import { MAX_CLAN_MEMBERS, MAX_FRIENDS } from './social/shared';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { PUT as acknowledgeMessage } from '../../routes/api/messages/[id]/+server';

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

  it('ne marque pas comme lu un message arrivé après la lecture de la conversation', async () => {
    const [a, b] = await players();
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    const conversationId = (await openDirect(a.id, b.id))!;
    const earlier = new Date('2026-01-01T12:00:00Z');
    const later = new Date(earlier.getTime() + 1000);
    const first = await db.message.create({
      data: { conversationId, authorId: a.id, content: 'Premier', createdAt: earlier },
    });
    const findMany = db.message.findMany.bind(db.message);
    const intercept = async (args: Parameters<typeof db.message.findMany>[0]) => {
      const rows = await findMany(args);
      await db.message.create({
        data: { conversationId, authorId: a.id, content: 'Arrivé ensuite', createdAt: later },
      });
      return rows;
    };
    const spy = vi
      .spyOn(db.message, 'findMany')
      .mockImplementationOnce(intercept as unknown as typeof db.message.findMany);
    try {
      expect((await readConversation(b.id, conversationId))?.messages).toHaveLength(1);
      expect(await unreadCount(b.id)).toBe(1);
      const acknowledge = (messageId: string) =>
        acknowledgeMessage({
          locals: { user: b },
          params: { id: conversationId },
          request: new Request('http://localhost/api/messages/read', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId }),
          }),
        } as unknown as Parameters<typeof acknowledgeMessage>[0]);
      expect((await acknowledge(first.id)).status).toBe(204);
      expect(await unreadCount(b.id)).toBe(1);
      await expect(acknowledge('message-inconnu')).rejects.toMatchObject({ status: 404 });
      await markRead(b.id, conversationId, later);
      await markRead(b.id, conversationId, earlier);
      expect(await unreadCount(b.id)).toBe(0);
    } finally {
      spy.mockRestore();
    }
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
      select: { role: true, clan: { select: { name: true } } },
    });
    expect(clan).toEqual({ role: 'OWNER', clan: { name: `${name}a` } });
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

  it('montre les derniers jeux lancés par les amis, sans ceux qu’ils ont masqués', async () => {
    const [a, b] = await players();
    const [stranger] = await players();
    const game = async (name: string) =>
      db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        },
      });
    const [old, fresh, hidden] = [await game('ancien'), await game('récent'), await game('caché')];
    const day = 86_400_000;
    await db.userGame.createMany({
      data: [
        { userId: b.id, gameId: old.id, lastPlayedAt: new Date(Date.now() - 3 * day) },
        { userId: b.id, gameId: fresh.id, lastPlayedAt: new Date(Date.now() - day) },
        { userId: b.id, gameId: hidden.id, lastPlayedAt: new Date(), hidden: true },
        { userId: stranger.id, gameId: fresh.id, lastPlayedAt: new Date() },
      ],
    });

    expect(await friendsPlaying(a.id)).toEqual([]);
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    const rows = await friendsPlaying(a.id);
    expect(rows.map((row) => row.game.id)).toEqual([fresh.id, old.id]);
    expect(rows[0].user.handle).toBe(b.handle);
  });

  it('habille le profil du jeu choisi, tant que le joueur le garde', async () => {
    const [player] = await players();
    const make = (name: string, adultOnly = false) =>
      db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          headerUrl: `https://cdn.example/${name}/header.jpg`,
          adultOnly,
        },
      });
    const [chosen, adult] = [await make('choisi'), await make('adulte', true)];
    await db.userGame.createMany({
      data: [
        { userId: player.id, gameId: chosen.id },
        { userId: player.id, gameId: adult.id },
      ],
    });
    const background = async (showAdult = false) =>
      (await userProfile(player.handle, null, showAdult))?.background ?? null;

    // Sans vitrine ni choix, pas de fond.
    expect(await background()).toBeNull();

    await db.user.update({ where: { id: player.id }, data: { backgroundGameId: chosen.id } });
    expect(await background()).toMatchObject({
      slug: chosen.slug,
      images: [
        'https://cdn.example/choisi/library_hero.jpg',
        'https://cdn.example/choisi/header.jpg',
      ],
    });
    expect((await userProfile(player.handle, null))?.user).not.toHaveProperty('backgroundGame');

    // Un jeu adulte choisi ne se montre qu'à qui a demandé à les voir.
    await db.user.update({ where: { id: player.id }, data: { backgroundGameId: adult.id } });
    expect(await background()).toBeNull();
    expect((await background(true))?.slug).toBe(adult.slug);

    // Masqué de la bibliothèque, le jeu choisi n'habille plus rien.
    await db.user.update({ where: { id: player.id }, data: { backgroundGameId: chosen.id } });
    await db.userGame.update({
      where: { userId_gameId: { userId: player.id, gameId: chosen.id } },
      data: { hidden: true },
    });
    expect(await background()).toBeNull();

    await db.userGame.update({
      where: { userId_gameId: { userId: player.id, gameId: chosen.id } },
      data: { hidden: false },
    });
    await db.user.update({ where: { id: player.id }, data: { backgroundOff: true } });
    expect(await background()).toBeNull();
  });

  it('garde le blocage subi par le profil absorbé', async () => {
    const [source, target] = await players();
    const [victim] = await players();
    await requestFriend(victim.id, target.handle);
    await acceptFriend(target.id, victim.id);
    await blockUser(victim.id, source.id);

    expect(await mergeUsers(await pendingMerge(source.id, target.id))).toBeNull();

    expect(await relationWith(victim.id, target.id)).toBe('blocked');
    expect(await requestFriend(target.id, victim.handle)).toBe('not_found');
  });

  it('coupe dans le chat du clan deux membres qui se sont bloqués', async () => {
    const [a, b] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    await createClan(a.id, name);
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    await inviteToClan(a.id, b.id);
    const clan = await db.clan.findUniqueOrThrow({
      where: { name },
      select: { id: true, conversation: { select: { id: true } } },
    });
    await acceptClanInvite(b.id, clan.id);
    const chat = clan.conversation?.id as string;
    await readConversation(b.id, chat);

    await blockUser(b.id, a.id);
    await sendMessage(a.id, chat, 'Tu me lis ?');

    expect(await unreadCount(b.id)).toBe(0);
    expect((await readConversation(b.id, chat))?.messages).toEqual([]);
    expect((await readConversation(a.id, chat))?.messages).toHaveLength(1);
  });

  it('supporte un départ et une exclusion simultanés', async () => {
    const [a, b] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    await createClan(a.id, name);
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    await inviteToClan(a.id, b.id);
    const { id } = await db.clan.findUniqueOrThrow({ where: { name } });
    await acceptClanInvite(b.id, id);

    await Promise.all([leaveClan(b.id), kickFromClan(a.id, b.id)]);
    await Promise.all([leaveClan(a.id), leaveClan(a.id)]);
    expect(await db.clan.findUnique({ where: { id } })).toBeNull();
  });

  it('transmet le clan au plus ancien membre, puis le supprime quand il est vide', async () => {
    const [a, b] = await players();
    expect(await inviteToClan(a.id, b.id)).toBe('officer_only');
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
      role: 'OWNER',
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
    // Le badge annonce une nouvelle : le panneau doit la porter, sinon la cloche ment.
    expect((await notifications(a.id))[0]).toMatchObject({
      kind: 'clan_rename',
      href: '/clan',
    });

    expect(await renameClan(b.id, `${PREFIX} propre`)).toBe('owner_only');
    const fresh = `${PREFIX} ${Math.random()}`;
    expect(await renameClan(a.id, fresh)).toBeNull();
    expect(await db.clan.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: fresh,
      flaggedName: null,
    });
    // Le nom choisi, la nouvelle disparaît : plus rien n'attend le chef.
    expect(await notifications(a.id)).not.toContainEqual(
      expect.objectContaining({ kind: 'clan_rename' }),
    );
    await leaveClan(b.id);
    await leaveClan(a.id);
  });
});

describe('plafond d’amis', () => {
  async function player() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    return db.user.findUniqueOrThrow({ where: { id: result.userId } });
  }

  /** `count` joueurs d'un coup : le plafond ne se teste pas avec trente allers-retours. */
  async function crowd(count: number) {
    const tag = Math.random().toString(36).slice(2, 8);
    await db.user.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        handle: `${PREFIX}-${tag}-${index}`,
        displayName: `${PREFIX} ami ${index}`,
      })),
    });
    return db.user.findMany({
      where: { handle: { startsWith: `${PREFIX}-${tag}-` } },
      select: { id: true, handle: true },
    });
  }

  async function befriend(userId: string, others: { id: string }[]) {
    await db.friendship.createMany({
      data: others.map((other) => ({
        requesterId: userId,
        addresseeId: other.id,
        accepted: true,
      })),
    });
  }

  it('accepte une dernière amitié au plafond, puis refuse sans perdre la demande', async () => {
    const me = await player();
    const [asker, late] = await crowd(2);
    await befriend(me.id, await crowd(MAX_FRIENDS - 1));
    await db.friendship.create({ data: { requesterId: asker.id, addresseeId: me.id } });

    expect(await acceptFriend(me.id, asker.id)).toBeNull();
    expect(await friendCount(me.id)).toBe(MAX_FRIENDS);

    await db.friendship.create({ data: { requesterId: late.id, addresseeId: me.id } });
    expect(await acceptFriend(me.id, late.id)).toBe('friends_full');
    expect(await friendCount(me.id)).toBe(MAX_FRIENDS);
    expect(await relationWith(me.id, late.id)).toBe('received');
  });

  it('refuse une demande quand le demandeur est plein, y compris en acceptant une reçue', async () => {
    const me = await player();
    const full = await player();
    await befriend(full.id, await crowd(MAX_FRIENDS));

    expect(await requestFriend(full.id, me.handle)).toBe('friends_full');
    expect(await relationWith(full.id, me.id)).toBe('none');

    await db.friendship.create({ data: { requesterId: full.id, addresseeId: me.id } });
    expect(await requestFriend(me.id, full.handle)).toBe('friends_full');
    expect(await relationWith(me.id, full.id)).toBe('received');
  });

  it('sérialise deux acceptations simultanées : une seule passe', async () => {
    const me = await player();
    const [first, second] = await crowd(2);
    await befriend(me.id, await crowd(MAX_FRIENDS - 1));
    await db.friendship.createMany({
      data: [
        { requesterId: first.id, addresseeId: me.id },
        { requesterId: second.id, addresseeId: me.id },
      ],
    });

    const results = await Promise.all([
      acceptFriend(me.id, first.id),
      acceptFriend(me.id, second.id),
    ]);

    expect(results.toSorted()).toEqual([null, 'friends_full'].toSorted());
    expect(await friendCount(me.id)).toBe(MAX_FRIENDS);
  });

  it('ne crée qu’une amitié quand deux demandes se croisent', async () => {
    const [a, b] = [await player(), await player()];

    await Promise.all([requestFriend(a.id, b.handle), requestFriend(b.id, a.handle)]);

    expect(
      await db.friendship.count({ where: { OR: [{ requesterId: a.id }, { addresseeId: a.id }] } }),
    ).toBe(1);
    expect(await relationWith(a.id, b.id)).toBe('friends');
    expect(await friendCount(a.id)).toBe(1);
  });
});

describe('rôles et demandes de clan', () => {
  async function player() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    return db.user.findUniqueOrThrow({ where: { id: result.userId } });
  }

  /** Un clan du test, et de quoi y placer des rôles sans repasser par les invitations. */
  async function clanWith(ownerId: string, roles: { id: string; role: 'OFFICER' | 'MEMBER' }[]) {
    const name = `${PREFIX} clan ${Math.random()}`;
    expect(await createClan(ownerId, name)).toBeNull();
    const clan = await db.clan.findUniqueOrThrow({ where: { name } });
    await db.clanMember.createMany({
      data: roles.map((member) => ({ userId: member.id, clanId: clan.id, role: member.role })),
    });
    return clan;
  }

  it('une demande est reçue par le chef et les officiers, acceptée par eux seuls', async () => {
    const [owner, officer, member, candidate] = [
      await player(),
      await player(),
      await player(),
      await player(),
    ];
    const clan = await clanWith(owner.id, [
      { id: officer.id, role: 'OFFICER' },
      { id: member.id, role: 'MEMBER' },
    ]);

    expect(await requestToJoinClan(candidate.id, clan.id)).toBeNull();
    expect((await clanRequests(officer.id)).map((row) => row.user.id)).toEqual([candidate.id]);
    expect(await clanRequests(owner.id)).toHaveLength(1);
    expect(await clanRequests(member.id)).toEqual([]);
    expect((await pendingInvites(officer.id)).clans).toBe(1);
    expect((await pendingInvites(member.id)).clans).toBe(0);

    expect(await acceptClanRequest(member.id, candidate.id)).toBe('officer_only');
    expect(await acceptClanRequest(officer.id, candidate.id)).toBeNull();
    expect(await db.clanMember.findUnique({ where: { userId: candidate.id } })).toMatchObject({
      clanId: clan.id,
      role: 'MEMBER',
    });
    expect(await clanRequests(officer.id)).toEqual([]);
  });

  it('refuse une demande quand le clan est plein, et sait refuser une demande reçue', async () => {
    const owner = await player();
    const tag = Math.random().toString(36).slice(2, 8);
    await db.user.createMany({
      data: Array.from({ length: MAX_CLAN_MEMBERS - 1 }, (_, index) => ({
        handle: `${PREFIX}-${tag}-${index}`,
        displayName: `${PREFIX} membre ${index}`,
      })),
    });
    const crowd = await db.user.findMany({
      where: { handle: { startsWith: `${PREFIX}-${tag}-` } },
      select: { id: true },
    });
    const clan = await clanWith(
      owner.id,
      crowd.map((user) => ({ id: user.id, role: 'MEMBER' })),
    );
    const [candidate, other] = [await player(), await player()];

    expect(await requestToJoinClan(candidate.id, clan.id)).toBe('clan_full');
    expect(await db.clanRequest.count({ where: { clanId: clan.id } })).toBe(0);

    await db.clanMember.delete({ where: { userId: crowd[0].id } });
    expect(await requestToJoinClan(other.id, clan.id)).toBeNull();
    expect(await declineClanRequest(owner.id, other.id)).toBeNull();
    expect(await db.clanRequest.count({ where: { clanId: clan.id } })).toBe(0);
    expect(await db.clanMember.count({ where: { userId: other.id } })).toBe(0);
  });

  it('accepte d’office la demande quand une invitation du même clan attend', async () => {
    const [owner, friend] = [await player(), await player()];
    const clan = await clanWith(owner.id, []);
    await requestFriend(owner.id, friend.handle);
    await acceptFriend(friend.id, owner.id);
    expect(await inviteToClan(owner.id, friend.id)).toBeNull();

    expect(await requestToJoinClan(friend.id, clan.id)).toBeNull();
    expect(await db.clanMember.findUnique({ where: { userId: friend.id } })).toMatchObject({
      clanId: clan.id,
    });
    expect(await db.clanInvite.count({ where: { userId: friend.id } })).toBe(0);
  });

  it('un officier exclut des membres, jamais un officier ni le chef', async () => {
    const [owner, officer, peer, member] = [
      await player(),
      await player(),
      await player(),
      await player(),
    ];
    const clan = await clanWith(owner.id, [
      { id: officer.id, role: 'OFFICER' },
      { id: peer.id, role: 'OFFICER' },
      { id: member.id, role: 'MEMBER' },
    ]);

    expect(await kickFromClan(member.id, peer.id)).toBe('officer_only');
    expect(await kickFromClan(officer.id, peer.id)).toBe('officer_only');
    expect(await kickFromClan(officer.id, owner.id)).toBe('owner_only');
    expect(await kickFromClan(officer.id, member.id)).toBeNull();
    expect(await db.clanMember.count({ where: { userId: member.id } })).toBe(0);

    expect(await kickFromClan(owner.id, owner.id)).toBe('self');
    expect(await kickFromClan(owner.id, officer.id)).toBeNull();
    expect(await db.clanMember.findUnique({ where: { userId: peer.id } })).toMatchObject({
      clanId: clan.id,
    });
  });

  it('seul le chef nomme et rétrograde un officier', async () => {
    const [owner, member, stranger] = [await player(), await player(), await player()];
    const clan = await clanWith(owner.id, [{ id: member.id, role: 'MEMBER' }]);

    expect(await setClanRole(member.id, member.id, 'OFFICER')).toBe('owner_only');
    expect(await setClanRole(owner.id, owner.id, 'OFFICER')).toBe('self');
    expect(await setClanRole(owner.id, stranger.id, 'OFFICER')).toBe('not_found');
    expect(await setClanRole(owner.id, member.id, 'OFFICER')).toBeNull();
    expect(await db.clanMember.findUnique({ where: { userId: member.id } })).toMatchObject({
      role: 'OFFICER',
    });
    expect(await setClanRole(owner.id, member.id, 'MEMBER')).toBeNull();
    expect(await db.clanMember.findUnique({ where: { userId: member.id } })).toMatchObject({
      role: 'MEMBER',
      clanId: clan.id,
    });
  });

  it('transmet le clan à un officier au départ du chef', async () => {
    const [owner, officer, member] = [await player(), await player(), await player()];
    await clanWith(owner.id, [
      { id: officer.id, role: 'OFFICER' },
      { id: member.id, role: 'MEMBER' },
    ]);

    await leaveClan(owner.id);
    expect(await db.clanMember.findUnique({ where: { userId: officer.id } })).toMatchObject({
      role: 'OWNER',
    });
    expect(await db.clanMember.findUnique({ where: { userId: member.id } })).toMatchObject({
      role: 'MEMBER',
    });
  });

  it('classe les clans aux points de collection, profils privés compris', async () => {
    const [rich, poor] = [await player(), await player()];
    const tag = Math.random().toString(36).slice(2, 8);
    const richClan = await clanWith(rich.id, []);
    const poorClan = await clanWith(poor.id, []);
    const card = async (userId: string, tier: number) => {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${tag} palier ${tier}`,
          slug: `${PREFIX}-${tag}-${Math.random().toString(36).slice(2)}`,
          tier,
        },
      });
      await db.userGame.create({
        data: {
          userId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 1,
          totalCount: 1,
        },
      });
    };
    await card(rich.id, 3);
    await card(poor.id, 1);
    await db.user.update({ where: { id: poor.id }, data: { isPublic: false } });

    const ranked = (await listClans()).filter((clan) =>
      [richClan.id, poorClan.id].includes(clan.id),
    );
    expect(ranked.map((clan) => clan.id)).toEqual([richClan.id, poorClan.id]);
    expect(ranked[0]).toMatchObject({ points: 100, members: 1, total: 1, open: true });
    // Le clan dont tous les membres sont privés reste classé, à zéro point visible.
    expect(ranked[1]).toMatchObject({ points: 0, members: 0, total: 1 });
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
