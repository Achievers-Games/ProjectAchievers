// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { db } from './db';
import { authenticatePartner, issuePartnerKey, revokePartnerKey } from './partner-api';
import { partnerGame, partnerUser, partnerUserGame, partnerUserGames } from './partner-queries';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();
afterAll(() => db.partnerApp.deleteMany({ where: { name: { startsWith: PREFIX } } }));

const event = (authorization?: string, address = '203.0.113.7') =>
  ({
    request: new Request('http://localhost/api/v1/users/x', {
      headers: authorization ? { authorization } : {},
    }),
    getClientAddress: () => address,
  }) as unknown as RequestEvent;

async function player(isPublic = true) {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  return db.user.update({ where: { id: result.userId }, data: { isPublic } });
}

const appid = () => `${PREFIX}-${Math.random().toString(36).slice(2)}`;

const game = (data: { platformGameId?: string; adultOnly?: boolean } = {}) =>
  db.game.create({
    data: {
      platform: 'STEAM',
      platformGameId: data.platformGameId ?? appid(),
      name: `${PREFIX} jeu partenaire`,
      slug: appid(),
      adultOnly: data.adultOnly ?? false,
      totalAchievements: 2,
    },
  });

const owns = (
  userId: string,
  gameId: string,
  data: { completion?: number; hidden?: boolean } = {},
) =>
  db.userGame.create({
    data: {
      userId,
      gameId,
      unlockedCount: data.completion === 100 ? 2 : 1,
      totalCount: 2,
      completion: data.completion ?? 50,
      hidden: data.hidden ?? false,
    },
  });

describe('clé partenaire', () => {
  it('ouvre l’API, puis plus rien une fois révoquée ou remplacée', async () => {
    const { app, key } = await issuePartnerKey(`${PREFIX} Lure`);
    expect(key.startsWith('ak_')).toBe(true);
    expect(app.keyHash).not.toContain(key.slice(3));

    expect(await authenticatePartner(event(`Bearer ${key}`))).toEqual({
      id: app.id,
      name: `${PREFIX} Lure`,
    });

    const { key: renewed } = await issuePartnerKey(`${PREFIX} Lure`);
    const old = await authenticatePartner(event(`Bearer ${key}`));
    expect(old).toBeInstanceOf(Response);
    expect((old as Response).status).toBe(401);
    expect(await authenticatePartner(event(`Bearer ${renewed}`))).not.toBeInstanceOf(Response);

    await revokePartnerKey(app.id);
    expect(((await authenticatePartner(event(`Bearer ${renewed}`))) as Response).status).toBe(401);
  });

  it('refuse sans clé, et freine qui essaie des clés au hasard', async () => {
    const missing = (await authenticatePartner(event())) as Response;
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: 'unauthorized' });

    const address = '203.0.113.99';
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) {
      last = (await authenticatePartner(event('Bearer ak_faux', address))) as Response;
    }
    expect(last?.status).toBe(429);
  });
});

describe('API partenaire', () => {
  it('montre un profil public, jamais un profil privé', async () => {
    const shown = await player();
    const hidden = await player(false);
    const profile = await partnerUser(shown.handle);
    expect(profile).toMatchObject({
      handle: shown.handle,
      cardUrl: expect.stringContaining(`/u/${shown.handle}/carte.svg`),
      stats: { games: 0, achievements: 0, cards: 0 },
    });
    expect(await partnerUser(hidden.handle)).toBeNull();
    expect(
      await partnerUserGames(hidden.handle, { platform: null, limit: 10, cursor: null }),
    ).toBeNull();
  });

  it('liste les jeux page par page, sans jeu masqué ni jeu adulte', async () => {
    const user = await player();
    const games = await Promise.all([game(), game(), game()]);
    const masked = await game();
    const adult = await game({ adultOnly: true });
    for (const g of games) await owns(user.id, g.id);
    await owns(user.id, masked.id, { hidden: true });
    await owns(user.id, adult.id);

    const first = await partnerUserGames(user.handle, { platform: null, limit: 2, cursor: null });
    expect(first?.items).toHaveLength(2);
    expect(first?.nextCursor).not.toBeNull();
    const second = await partnerUserGames(user.handle, {
      platform: null,
      limit: 2,
      cursor: first!.nextCursor,
    });
    expect(second?.items).toHaveLength(1);
    expect(second?.nextCursor).toBeNull();

    const ids = [...first!.items, ...second!.items].map((item) => item.game.platformGameId);
    expect(ids.sort()).toEqual(games.map((g) => g.platformGameId).sort());
    expect(first?.items[0]).toMatchObject({
      game: { platform: 'steam' },
      progress: { unlocked: 1, total: 2, completion: 50, completed: false },
    });

    const psn = await partnerUserGames(user.handle, { platform: 'PSN', limit: 10, cursor: null });
    expect(psn?.items).toEqual([]);
  });

  it('garde secret un succès caché tant que le joueur ne l’a pas', async () => {
    const user = await player();
    const g = await game();
    await owns(user.id, g.id);
    const [secret, done] = await Promise.all([
      db.achievement.create({
        data: { gameId: g.id, platformAchievementId: 'SECRET', name: 'Fin cachée', hidden: true },
      }),
      db.achievement.create({
        data: { gameId: g.id, platformAchievementId: 'DONE', name: 'Premier pas', hidden: true },
      }),
    ]);
    await db.userAchievement.create({
      data: { userId: user.id, achievementId: done.id, unlockedAt: new Date('2026-01-02') },
    });

    const detail = await partnerUserGame(user.handle, 'STEAM', g.platformGameId);
    const byId = new Map(detail!.achievements.map((a) => [a.id, a]));
    expect(byId.get('SECRET')).toMatchObject({ name: null, description: null, unlocked: false });
    expect(byId.get('DONE')).toMatchObject({
      name: 'Premier pas',
      unlocked: true,
      unlockedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(secret.id).toBeTruthy();
    expect(await partnerUserGame(user.handle, 'STEAM', 'inconnu')).toBeNull();
  });

  it('retrouve un jeu par son appid et ne compte que les joueurs publics', async () => {
    const id = appid();
    const g = await game({ platformGameId: id });
    // L'un après l'autre : créés ensemble, ils se disputeraient le même identifiant.
    const a = await player();
    const b = await player();
    const c = await player(false);
    await owns(a.id, g.id, { completion: 100 });
    await owns(b.id, g.id);
    await owns(c.id, g.id, { completion: 100 });

    expect(await partnerGame('STEAM', id)).toMatchObject({
      platform: 'steam',
      platformGameId: id,
      players: 2,
      completions: 1,
      completionRate: 50,
    });
    const adult = await game({ adultOnly: true });
    expect(await partnerGame('STEAM', adult.platformGameId)).toBeNull();
  });
});
