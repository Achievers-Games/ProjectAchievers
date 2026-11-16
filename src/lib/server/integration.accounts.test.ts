// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';

import { profileSchema, resolveIdentity, updateProfile, type Identity } from './accounts';
import { db } from './db';
import { mergeUsers } from './merge';
import {
  markCelebrated,
  recentUnlocks,
  saveAchievements,
  saveProgress,
  upsertGame,
} from './sync/store';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

describe('rattachement des comptes', () => {
  it('crée un utilisateur pour une identité inconnue', async () => {
    const result = await resolveIdentity(identity(), null);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it('retrouve le même utilisateur à la connexion suivante', async () => {
    const id = identity();
    const first = await resolveIdentity(id, null);
    const second = await resolveIdentity(id, null);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(first.ok && second.ok && first.userId === second.userId).toBe(true);
  });

  it('ne fusionne jamais deux personnes portant le même pseudo', async () => {
    const displayName = `${PREFIX} homonyme`;
    const victim = await resolveIdentity(identity({ displayName }), null);
    const attacker = await resolveIdentity(identity({ displayName }), null);
    expect(victim.ok && attacker.ok && victim.userId !== attacker.userId).toBe(true);
  });

  it('refuse de voler un compte déjà lié à un autre profil', async () => {
    const id = identity();
    await resolveIdentity(id, null);
    const other = await resolveIdentity(identity(), null);
    if (!other.ok) throw new Error('création attendue');
    expect(await resolveIdentity(id, other.userId)).toMatchObject({
      ok: false,
      reason: 'already_linked',
    });
  });

  it('refuse un second compte du même fournisseur', async () => {
    const first = await resolveIdentity(identity(), null);
    if (!first.ok) throw new Error('création attendue');
    expect(await resolveIdentity(identity(), first.userId)).toEqual({
      ok: false,
      reason: 'provider_taken',
    });
  });

  it('chiffre les jetons au repos', async () => {
    const id = identity({ provider: 'DISCORD', accessToken: 'jeton-en-clair' });
    await resolveIdentity(id, null);
    const row = await db.linkedAccount.findUniqueOrThrow({
      where: {
        provider_providerUserId: { provider: 'DISCORD', providerUserId: id.providerUserId },
      },
    });
    expect(row.accessTokenEnc).toBeTruthy();
    expect(row.accessTokenEnc).not.toContain('jeton-en-clair');
  });
});

describe('modification du profil', () => {
  const handle = () => `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`;

  async function profile(overrides: Partial<Identity> = {}) {
    const created = await resolveIdentity(identity(overrides), null);
    if (!created.ok) throw new Error('création attendue');
    return created.userId;
  }

  it('garde le nom choisi après une reconnexion', async () => {
    const id = identity({ displayName: `${PREFIX} Prénom Nom`, avatarUrl: 'https://a.test/1.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('création attendue');

    const newHandle = handle();
    expect(
      await updateProfile(created.userId, {
        displayName: 'Pseudo',
        handle: newHandle,
        avatarUrl: 'https://a.test/1.png',
      }),
    ).toBeNull();
    await resolveIdentity(id, null);

    expect(await db.user.findUniqueOrThrow({ where: { id: created.userId } })).toMatchObject({
      displayName: 'Pseudo',
      handle: newHandle,
    });
  });

  it('refuse un identifiant déjà pris', async () => {
    const first = await profile();
    const second = await profile();
    const { handle: taken } = await db.user.findUniqueOrThrow({ where: { id: first } });
    expect(
      await updateProfile(second, { displayName: 'Pseudo', handle: taken, avatarUrl: '' }),
    ).toBe('handle_taken');
  });

  it("refuse une image qui ne vient pas d'un compte lié", async () => {
    const userId = await profile({ avatarUrl: 'https://a.test/1.png' });
    await profile({ avatarUrl: 'https://a.test/autre.png' });
    expect(
      await updateProfile(userId, {
        displayName: 'Pseudo',
        handle: handle(),
        avatarUrl: 'https://a.test/autre.png',
      }),
    ).toBe('avatar_unknown');
  });

  it('valide le nom et le format de l’identifiant', () => {
    const valid = { displayName: '  Pseudo ', handle: 'Mon-Pseudo', avatarUrl: '' };
    expect(profileSchema.parse(valid)).toMatchObject({
      displayName: 'Pseudo',
      handle: 'mon-pseudo',
    });
    for (const bad of ['a', 'ab_cd', '-abc', 'abc-', 'a'.repeat(25), 'é-abc', '../admin']) {
      expect(profileSchema.safeParse({ ...valid, handle: bad }).success).toBe(false);
    }
    for (const bad of ['x', 'y'.repeat(33), 'nom‮inversé', 'a\nb']) {
      expect(profileSchema.safeParse({ ...valid, displayName: bad }).success).toBe(false);
    }
  });
});

describe('calcul de la progression', () => {
  async function fixture(trophyTypes: ('PLATINUM' | 'GOLD' | 'ACHIEVEMENT')[]) {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('création attendue');
    const game = await upsertGame({
      platform: 'PSN',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(
      game.id,
      trophyTypes.map((trophyType, i) => ({
        platformAchievementId: String(i),
        name: `T${i}`,
        description: '',
        hidden: false,
        trophyType,
      })),
    );
    return { userId: created.userId, gameId: game.id };
  }

  it('calcule la complétion et reste idempotent', async () => {
    const { userId, gameId } = await fixture(['GOLD', 'GOLD']);
    const unlock = [{ platformAchievementId: '0', unlockedAt: new Date() }];
    const first = await saveProgress(userId, gameId, unlock);
    expect(first.gained).toBe(1);
    expect(first.fresh.map((a) => a.name)).toHaveLength(1);
    const again = await saveProgress(userId, gameId, unlock);
    expect(again.gained).toBe(0);
    expect(again.fresh).toEqual([]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row).toMatchObject({ unlockedCount: 1, totalCount: 2, completion: 50, platinum: false });
  });

  it('exige le trophée platine sur PSN', async () => {
    const { userId, gameId } = await fixture(['PLATINUM', 'GOLD']);
    await saveProgress(userId, gameId, [{ platformAchievementId: '1', unlockedAt: new Date() }]);
    await saveProgress(userId, gameId, [{ platformAchievementId: '0', unlockedAt: new Date() }]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row.platinum).toBe(true);
  });

  it('réserve la platine au trophée, pas au 100 %', async () => {
    const { userId, gameId } = await fixture(['ACHIEVEMENT']);
    await saveProgress(userId, gameId, [{ platformAchievementId: '0', unlockedAt: new Date() }]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row).toMatchObject({ completion: 100, platinum: false });
  });

  it('ignore un déverrouillage inconnu du catalogue', async () => {
    const { userId, gameId } = await fixture(['GOLD']);
    const result = await saveProgress(userId, gameId, [
      { platformAchievementId: '99', unlockedAt: new Date() },
    ]);
    expect(result).toMatchObject({ gained: 0, fresh: [] });
  });

  it('retrouve les succès de la semaine pour la visite suivante', async () => {
    const { userId, gameId } = await fixture(['GOLD', 'GOLD']);
    const day = 24 * 60 * 60 * 1000;
    await saveProgress(userId, gameId, [
      { platformAchievementId: '0', unlockedAt: new Date(Date.now() - 30 * day) },
      { platformAchievementId: '1', unlockedAt: new Date(Date.now() - day) },
    ]);
    const recent = await recentUnlocks(userId);
    expect(recent).toMatchObject([{ title: 'T1', icon: null, game: `${PREFIX} jeu` }]);
  });

  it('ne rejoue pas sur un autre appareil un succès déjà fêté', async () => {
    const { userId, gameId } = await fixture(['GOLD', 'GOLD']);
    const hour = 60 * 60 * 1000;
    await saveProgress(userId, gameId, [
      { platformAchievementId: '0', unlockedAt: new Date(Date.now() - hour) },
      { platformAchievementId: '1', unlockedAt: new Date(Date.now() - 2 * hour) },
    ]);
    const [first] = await recentUnlocks(userId);
    await markCelebrated(userId, [first!.id]);
    const recent = await recentUnlocks(userId);
    expect(recent.map((unlock) => unlock.title)).toEqual(['T1']);
  });

  it('ne garde que les trois derniers succès récents', async () => {
    const { userId, gameId } = await fixture(['GOLD', 'GOLD', 'GOLD', 'GOLD']);
    const hour = 60 * 60 * 1000;
    await saveProgress(
      userId,
      gameId,
      [0, 1, 2, 3].map((i) => ({
        platformAchievementId: String(i),
        unlockedAt: new Date(Date.now() - i * hour),
      })),
    );
    const recent = await recentUnlocks(userId);
    expect(recent.map((unlock) => unlock.title)).toEqual(['T0', 'T1', 'T2']);
  });
});

describe('fusion de profils', () => {
  async function twoProfiles() {
    const steam = identity();
    const discord = identity({ provider: 'DISCORD' });
    const source = await resolveIdentity(steam, null);
    const target = await resolveIdentity(discord, null);
    if (!source.ok || !target.ok) throw new Error('création attendue');
    return {
      sourceId: source.userId,
      targetId: target.userId,
      merge: {
        sourceId: source.userId,
        targetId: target.userId,
        provider: steam.provider,
        providerUserId: steam.providerUserId,
      },
      steam,
    };
  }

  it('garde les succès du site des deux profils', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await db.siteUnlock.createMany({
      data: [
        { userId: sourceId, code: 'deserter' },
        { userId: sourceId, code: 'stage_name' },
        { userId: targetId, code: 'deserter' },
      ],
    });
    expect(await mergeUsers(merge)).toBeNull();
    const rows = await db.siteUnlock.findMany({ where: { userId: targetId } });
    expect(rows.map((row) => row.code).toSorted()).toEqual(['deserter', 'stage_name']);
  });

  it('garde les accès OAuth et les événements partenaires du profil absorbé', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    const apps = await Promise.all(
      ['seul', 'double', 'revoque'].map((name) =>
        db.partnerApp.create({
          data: {
            name: `${PREFIX}-${name}-${Math.random()}`,
            keyHash: `${PREFIX}-${name}-${Math.random()}`,
            keyPrefix: 'pa',
          },
        }),
      ),
    );
    const [only, both, revoked] = apps.map((app) => app.id) as [string, string, string];
    const grant = (userId: string, appId: string, revokedAt: Date | null = null) =>
      db.oAuthGrant.create({ data: { userId, appId, scopes: ['profile'], revokedAt } });
    const kept = await grant(sourceId, only);
    await grant(sourceId, both);
    const targetGrant = await grant(targetId, both);
    const active = await grant(sourceId, revoked);
    await grant(targetId, revoked, new Date());
    const event = await db.partnerEvent.create({
      data: { appId: only, userId: sourceId, type: 'user.updated' },
    });

    expect(await mergeUsers(merge)).toBeNull();

    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
    const grants = await db.oAuthGrant.findMany({
      where: { appId: { in: [only, both, revoked] } },
      select: { id: true, userId: true },
    });
    expect(grants.toSorted(byId)).toEqual(
      [kept, targetGrant, active].map((g) => ({ id: g.id, userId: targetId })).toSorted(byId),
    );
    expect((await db.partnerEvent.findUniqueOrThrow({ where: { id: event.id } })).userId).toBe(
      targetId,
    );
  });

  async function guideFor(authorId: string) {
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(game.id, [
      {
        platformAchievementId: '0',
        name: 'T',
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT',
      },
    ]);
    const achievement = await db.achievement.findFirstOrThrow({ where: { gameId: game.id } });
    const guide = await db.guide.create({
      data: { achievementId: achievement.id, authorId, contentMd: 'x' },
    });
    return { game, achievement, guide };
  }

  it('réunit comptes, progression et contenus puis supprime le profil absorbé', async () => {
    const { sourceId, targetId, merge, steam } = await twoProfiles();
    const { game, guide } = await guideFor(sourceId);
    await db.userGame.create({ data: { userId: sourceId, gameId: game.id } });

    expect(await mergeUsers(merge)).toBeNull();

    expect(await db.user.findUnique({ where: { id: sourceId } })).toBeNull();
    expect(await db.linkedAccount.count({ where: { userId: targetId } })).toBe(2);
    expect(await db.userGame.count({ where: { userId: targetId } })).toBe(1);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).authorId).toBe(targetId);

    const login = await resolveIdentity(steam, null);
    expect(login).toMatchObject({ ok: true, userId: targetId, created: false });
  });

  it('garde un seul vote par guide et recalcule le score', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    const { guide } = await guideFor(sourceId);
    await db.guideVote.createMany({
      data: [
        { guideId: guide.id, userId: sourceId, value: 1 },
        { guideId: guide.id, userId: targetId, value: -1 },
      ],
    });
    await db.guide.update({ where: { id: guide.id }, data: { score: 0 } });

    expect(await mergeUsers(merge)).toBeNull();

    expect(await db.guideVote.findMany({ where: { guideId: guide.id } })).toMatchObject([
      { userId: targetId, value: -1 },
    ]);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).score).toBe(-1);
  });

  it('conserve le rôle le plus élevé et le choix de profil privé', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await db.user.update({
      where: { id: sourceId },
      data: { role: 'MODERATOR', isPublic: false },
    });

    await mergeUsers(merge);

    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({
      role: 'MODERATOR',
      isPublic: false,
    });
  });

  it('refuse deux comptes du même fournisseur et ne change rien', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await resolveIdentity(identity({ provider: 'STEAM' }), targetId);

    expect(await mergeUsers(merge)).toBe('provider_conflict');
    expect(await db.user.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('refuse si le compte a changé de profil depuis la demande', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    expect(await mergeUsers({ ...merge, providerUserId: 'autre' })).toBe('stale');
    expect(await mergeUsers({ ...merge, sourceId: targetId })).toBe('stale');
    expect(await db.user.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('attend la fin des synchronisations', async () => {
    const { sourceId, merge } = await twoProfiles();
    await db.linkedAccount.updateMany({
      where: { userId: sourceId },
      data: { syncStatus: 'SYNCING' },
    });
    expect(await mergeUsers(merge)).toBe('sync_running');
  });
});

describe('création de compte', () => {
  it('reprend l’avatar animé et le cadre du compte', async () => {
    const look = {
      avatarUrl: 'https://exemple.fr/avatar.png',
      avatarMotionUrl: 'https://exemple.fr/avatar.gif',
      frameUrl: 'https://exemple.fr/cadre.png',
      frameMotionUrl: 'https://exemple.fr/cadre.gif',
    };
    const result = await resolveIdentity(identity(look), null);
    if (!result.ok) throw new Error('compte non créé');
    const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user).toMatchObject({
      avatarUrl: look.avatarUrl,
      avatarMotionUrl: look.avatarMotionUrl,
      frame: look.frameUrl,
      frameMotionUrl: look.frameMotionUrl,
    });
  });
});
