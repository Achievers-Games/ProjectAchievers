// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import type { RequestEvent } from '@sveltejs/kit';
import type { Platform } from '#prisma';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { db } from './db';
import {
  apiAvatar,
  authenticatePartner,
  issuePartnerKey,
  listParams,
  LOOKUP_MAX,
  PAGE_MAX,
  revokePartnerKey,
} from './partner-api';
import {
  partnerAlmost,
  partnerGame,
  partnerGameAchievements,
  partnerPopularGames,
  partnerRecentCompletions,
  partnerUser,
  partnerUserGame,
  partnerUserGames,
  partnerUsersLookup,
} from './partner-queries';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { saveProgress } from './sync/store';
import { POST as LOOKUP } from '../../routes/api/v1/games/lookup/+server';

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

/** La même lecture que la route : les paramètres passent par `listParams`, comme en production. */
async function listPage(handle: string, query = '', platform: Platform | null = null) {
  const list = listParams(new URL(`http://localhost/api/v1/users/${handle}/games${query}`));
  if (list instanceof Response) throw new Error(`paramètres refusés (${list.status})`);
  const games = await partnerUserGames(handle, { platform, ...list });
  if (!games) throw new Error('profil absent');
  return games;
}

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

    const first = await listPage(user.handle, '?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listPage(
      user.handle,
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items].map((item) => item.game.platformGameId);
    expect(ids.sort()).toEqual(games.map((g) => g.platformGameId).sort());
    expect(first.items[0]).toMatchObject({
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

describe('profil par son id', () => {
  it('lit un profil public par son id comme par son handle, jamais un profil privé', async () => {
    const shown = await player();
    const hidden = await player(false);
    expect(await partnerUser(shown.id)).toMatchObject({ id: shown.id, handle: shown.handle });
    expect(await partnerUser(hidden.id)).toBeNull();
    expect(
      await partnerUserGames(shown.id, { platform: null, limit: 10, cursor: null }),
    ).toMatchObject({ items: [] });
  });

  it('donne toujours un avatar en https, ou null', () => {
    expect(apiAvatar('http://static-resource.np.community.playstation.net/a.png')).toBe(
      'https://static-resource.np.community.playstation.net/a.png',
    );
    expect(apiAvatar('https://cdn.discordapp.com/a.png')).toBe('https://cdn.discordapp.com/a.png');
    expect(apiAvatar(null)).toBeNull();
    expect(apiAvatar('ftp://ailleurs/a.png')).toBeNull();
  });
});

describe('difficulté du 100 %', () => {
  it('compte les manquables, la rareté et les guides lisibles', async () => {
    const g = await game();
    const author = await player();
    const [rare, missable] = await Promise.all([
      db.achievement.create({
        data: { gameId: g.id, platformAchievementId: 'RARE', name: 'Rare', globalRarity: 1.5 },
      }),
      db.achievement.create({
        data: {
          gameId: g.id,
          platformAchievementId: 'MANQUABLE',
          name: 'Manquable',
          globalRarity: 40,
          missable: true,
        },
      }),
    ]);
    const guide = (data: { achievementId?: string; gameId?: string; score?: number }) =>
      db.guide.create({ data: { authorId: author.id, contentMd: 'Texte', ...data } });
    await guide({ achievementId: rare.id });
    // Enterré par les votes : il ne compte plus.
    await guide({ achievementId: missable.id, score: -5 });
    const weak = await guide({ gameId: g.id, score: 1 });
    const best = await guide({ gameId: g.id, score: 7 });

    const card = await partnerGame('STEAM', g.platformGameId);
    expect(card?.difficulty).toEqual({
      missableAchievements: 1,
      missablesReviewed: false,
      rarestAchievement: 1.5,
    });
    expect(card?.guides).toEqual({
      achievementsCovered: 1,
      gameGuides: 2,
      bestGameGuideUrl: expect.stringContaining(`/jeux/${g.slug}/guides/${best.id}`),
    });
    expect(weak.id).not.toBe(best.id);
  });

  it('publie la médiane des relevés au 100 % à partir de vingt mesures publiques admissibles', async () => {
    const g = await game();
    await db.achievement.createMany({
      data: ['FIRST', 'LAST'].map((id) => ({
        gameId: g.id,
        platformAchievementId: id,
        name: id,
      })),
    });
    const finishedAt = Date.now() - 3_600_000;
    const unlocks = (at: number) => [
      { platformAchievementId: 'FIRST', unlockedAt: new Date(at - 60_000) },
      { platformAchievementId: 'LAST', unlockedAt: new Date(at) },
    ];
    const finish = async (minutes: number, isPublic = true, at = finishedAt) => {
      const p = await player(isPublic);
      await saveProgress(p.id, g.id, unlocks(at), { playtimeMinutes: minutes }, { complete: true });
      return p;
    };
    const first = await finish(600);
    for (let i = 1; i < 19; i++) await finish(600 + i * 20);
    // Les heures postérieures, un profil privé et une complétion déjà ancienne ne changent rien.
    await saveProgress(
      first.id,
      g.id,
      unlocks(finishedAt),
      { playtimeMinutes: 6000 },
      { complete: true },
    );
    await finish(5, false);
    await finish(10, true, finishedAt - 2 * 86_400_000);
    expect((await partnerGame('STEAM', g.platformGameId))?.completionTime).toBeNull();

    await finish(980);
    expect((await partnerGame('STEAM', g.platformGameId))?.completionTime).toEqual({
      medianMinutes: 790,
      sample: 20,
    });

    const review = await db.steamIntegrityReview.create({
      data: {
        userId: first.id,
        gameId: g.id,
        steamId: `${PREFIX}-completion-review`,
        flagged: [],
        approved: [],
        rejected: [],
        snapshot: [],
      },
    });
    expect((await partnerGame('STEAM', g.platformGameId))?.completionTime).toBeNull();
    await db.steamIntegrityReview.delete({ where: { id: review.id } });

    await db.achievement.update({
      where: { gameId_platformAchievementId: { gameId: g.id, platformAchievementId: 'LAST' } },
      data: { platformAchievementId: 'REPLACEMENT' },
    });
    expect((await partnerGame('STEAM', g.platformGameId))?.completionTime).toBeNull();
  });
});

describe('recherche groupée de jeux', () => {
  const lookup = async (body: unknown, key: string) =>
    LOOKUP({
      request: new Request('http://localhost/api/v1/games/lookup', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      getClientAddress: () => '203.0.113.88',
    } as unknown as Parameters<typeof LOOKUP>[0]);

  it('rend les jeux dans l’ordre demandé, et range les inconnus à part', async () => {
    const { key } = await issuePartnerKey(`${PREFIX} lot`);
    const [first, second] = [await game(), await game()];
    const adult = await game({ adultOnly: true });

    const response = await lookup(
      {
        games: [
          { platform: 'steam', id: second.platformGameId },
          { platform: 'STEAM', id: first.platformGameId },
          { platform: 'steam', id: second.platformGameId },
          { platform: 'steam', id: adult.platformGameId },
          { platform: 'steam', id: 'inconnu' },
        ],
      },
      key,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { platformGameId: string }[];
      missing: { platform: string; id: string }[];
    };
    expect(body.items.map((item) => item.platformGameId)).toEqual([
      second.platformGameId,
      first.platformGameId,
    ]);
    expect(body.missing).toEqual([
      { platform: 'steam', id: adult.platformGameId },
      { platform: 'steam', id: 'inconnu' },
    ]);
  });

  it('refuse une plateforme inconnue ou un lot trop gros', async () => {
    const { key } = await issuePartnerKey(`${PREFIX} lot refusé`);
    expect((await lookup({ games: [{ platform: 'epic', id: '1' }] }, key)).status).toBe(400);
    const tooMany = Array.from({ length: LOOKUP_MAX + 1 }, (_, i) => ({
      platform: 'steam',
      id: String(i),
    }));
    expect((await lookup({ games: tooMany }, key)).status).toBe(400);
    expect((await lookup({ games: [] }, key)).status).toBe(400);
  });
});

describe('champs et filtres de l’API partenaire', () => {
  const params = (query = '') =>
    listParams(new URL(`http://localhost/api/v1/users/ada/games${query}`));

  it('refuse un paramètre incompris au lieu de le remplacer en silence', async () => {
    const refused = (query: string) => params(query) as Response;
    expect(refused('?limit=abc').status).toBe(400);
    expect(await refused('?limit=abc').json()).toMatchObject({ error: 'bad_request' });
    expect(refused('?sort=bidon').status).toBe(400);
    expect(refused('?status=fini').status).toBe(400);
    expect(refused('?since=hier').status).toBe(400);
    // Un curseur d'avant les tris ne vaut que pour l'ordre par défaut.
    expect(refused('?sort=completion&cursor=abc').status).toBe(400);
    // Au-delà du maximum, le refus annoncé par le message plutôt qu'une page tronquée.
    expect(refused(`?limit=${PAGE_MAX + 1}`).status).toBe(400);
  });

  it('refuse un curseur dont la valeur ne va pas avec son tri', () => {
    const forged = (sort: string, value: unknown) =>
      params(
        `?sort=${sort}&cursor=${encodeURIComponent(
          `k1.${Buffer.from(JSON.stringify([sort, value, 'jeu'])).toString('base64url')}`,
        )}`,
      );
    // Sans ce contrôle, la requête recevait une date invalide et répondait 500.
    expect((forged('updated', 'pas-une-date') as Response).status).toBe(400);
    expect((forged('lastUnlocked', 'demain') as Response).status).toBe(400);
    expect((forged('completion', 'cent') as Response).status).toBe(400);
    expect((forged('name', 42) as Response).status).toBe(400);
    expect(forged('updated', '2026-01-02T00:00:00.000Z')).not.toBeInstanceOf(Response);
    expect(forged('lastUnlocked', null)).not.toBeInstanceOf(Response);
  });

  it('rend les champs de progression, de jeu et de succès que le site connaît', async () => {
    const user = await player();
    const g = await game();
    await owns(user.id, g.id, { completion: 100 });
    await db.userGame.update({
      where: { userId_gameId: { userId: user.id, gameId: g.id } },
      data: { playtimeMinutes: 1234, lastPlayedAt: new Date('2026-02-03T10:00:00Z') },
    });
    await db.game.update({
      where: { id: g.id },
      data: { tags: [1667, 492], familyKey: `${PREFIX}-famille` },
    });
    await db.achievement.create({
      data: {
        gameId: g.id,
        platformAchievementId: 'POINTS',
        name: 'Un',
        points: 25,
        missable: true,
      },
    });

    const detail = await partnerUserGame(user.handle, 'STEAM', g.platformGameId);
    expect(detail?.game).toMatchObject({ tags: [1667, 492], familyKey: `${PREFIX}-famille` });
    // Le temps de jeu reste privé : le site ne le montre pas, l'API ne le donne pas.
    expect(detail?.progress).not.toHaveProperty('playtimeMinutes');
    expect(detail?.progress).not.toHaveProperty('lastPlayedAt');
    expect(detail?.progress.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(detail?.achievements.find((a) => a.id === 'POINTS')).toMatchObject({
      points: 25,
      missable: true,
    });
  });

  it('filtre par état et trie page après page', async () => {
    const user = await player();
    const done = await game();
    const started = await game();
    const untouched = await game();
    await owns(user.id, done.id, { completion: 100 });
    await owns(user.id, started.id, { completion: 40 });
    await owns(user.id, untouched.id, { completion: 0 });

    const ids = async (query: string) =>
      (await listPage(user.handle, query)).items.map((item) => item.game.platformGameId);

    expect(await ids('?status=completed')).toEqual([done.platformGameId]);
    expect(await ids('?status=started')).toEqual([started.platformGameId]);
    expect(await ids('?status=untouched')).toEqual([untouched.platformGameId]);

    expect(await ids('?sort=completion')).toEqual([
      done.platformGameId,
      started.platformGameId,
      untouched.platformGameId,
    ]);

    // Le tri par nom passe par la relation : il a son propre curseur.
    await db.game.update({ where: { id: untouched.id }, data: { name: `${PREFIX} A` } });
    await db.game.update({ where: { id: started.id }, data: { name: `${PREFIX} B` } });
    await db.game.update({ where: { id: done.id }, data: { name: `${PREFIX} C` } });
    expect(await ids('?sort=name')).toEqual([
      untouched.platformGameId,
      started.platformGameId,
      done.platformGameId,
    ]);
    const byName = await listPage(user.handle, '?sort=name&limit=1');
    const afterName = await listPage(
      user.handle,
      `?sort=name&limit=1&cursor=${encodeURIComponent(byName.nextCursor!)}`,
    );
    expect(afterName.items[0].game.platformGameId).toBe(started.platformGameId);

    // Le curseur porte la valeur de tri : la page suivante reprend où l'on s'est arrêté.
    const first = await listPage(user.handle, '?sort=completion&limit=1');
    expect(first.items[0].game.platformGameId).toBe(done.platformGameId);
    const second = await listPage(
      user.handle,
      `?sort=completion&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.items[0].game.platformGameId).toBe(started.platformGameId);
  });

  it('ne relit que ce qui a été réécrit depuis un instant donné', async () => {
    const user = await player();
    const g = await game();
    await owns(user.id, g.id);

    expect((await listPage(user.handle, '?since=2000-01-01T00:00:00Z')).items).toHaveLength(1);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await listPage(user.handle, `?since=${future}`)).items).toHaveLength(0);
  });
});

describe('jeux presque finis', () => {
  it('range les jeux commencés du plus proche du 100 % au plus lointain', async () => {
    const user = await player();
    const close = await game();
    const far = await game();
    const done = await game();
    const adult = await game({ adultOnly: true });
    const achievements = async (gameId: string, count: number) => {
      const list = [];
      for (let i = 0; i < count; i++) {
        list.push(
          await db.achievement.create({
            data: {
              gameId,
              platformAchievementId: `A${i}`,
              name: `Succès ${i}`,
              globalRarity: 10 * (i + 1),
              missable: i === count - 1,
            },
          }),
        );
      }
      return list;
    };
    const [closeList, farList] = [await achievements(close.id, 3), await achievements(far.id, 4)];
    await achievements(adult.id, 2);
    await owns(user.id, close.id, { completion: 66 });
    await owns(user.id, far.id, { completion: 25 });
    await owns(user.id, done.id, { completion: 100 });
    await owns(user.id, adult.id, { completion: 50 });
    const unlock = (achievementId: string) =>
      db.userAchievement.create({
        data: { userId: user.id, achievementId, unlockedAt: new Date('2026-01-01') },
      });
    await unlock(closeList[0]!.id);
    await unlock(closeList[1]!.id);
    await unlock(farList[0]!.id);

    const almost = await partnerAlmost(user.handle);
    expect(almost?.items.map((item) => item.game.platformGameId)).toEqual([
      close.platformGameId,
      far.platformGameId,
    ]);
    expect(almost?.items[0]?.remaining).toEqual({
      achievements: 1,
      hardestRarity: 30,
      easiestRarity: 30,
      missable: 1,
      points: 10,
    });
    expect(almost?.items[1]?.remaining.achievements).toBe(3);
    expect(await partnerAlmost((await player(false)).handle)).toBeNull();
  });
});

describe('jeux populaires', () => {
  it('classe par 100 % atteints sur la période, sans profil privé ni jeu non vérifié', async () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const recent = new Date('2026-06-12T12:00:00Z');
    const old = new Date('2026-04-01T12:00:00Z');
    const checked = { contentCheckedAt: new Date('2026-01-01') };
    const [hot, warm, unchecked] = [await game(), await game(), await game()];
    await db.game.updateMany({ where: { id: { in: [hot.id, warm.id] } }, data: checked });
    const play = async (gameId: string, completion: number, at: Date, isPublic = true) => {
      const p = await player(isPublic);
      await owns(p.id, gameId, { completion });
      await db.userGame.update({
        where: { userId_gameId: { userId: p.id, gameId } },
        data: { lastUnlockedAt: at },
      });
    };
    await play(hot.id, 100, recent);
    await play(hot.id, 100, recent);
    await play(hot.id, 100, old);
    await play(warm.id, 100, recent);
    await play(warm.id, 50, recent);
    await play(warm.id, 100, recent, false);
    await play(unchecked.id, 100, recent);

    const week = await partnerPopularGames('week', 50, now);
    const ours = week.items.filter((item) =>
      [hot.platformGameId, warm.platformGameId, unchecked.platformGameId].includes(
        item.game.platformGameId,
      ),
    );
    expect(
      ours.map((item) => [item.game.platformGameId, item.periodCompletions, item.activePlayers]),
    ).toEqual([
      [hot.platformGameId, 2, 2],
      [warm.platformGameId, 1, 2],
    ]);
  });
});

describe('derniers 100 %', () => {
  it('donne les 100 % récents des joueurs publics, le plus récent d’abord, avec la carte', async () => {
    const [first, second, hidden] = [await game(), await game(), await game()];
    await db.game.updateMany({
      where: { id: { in: [first.id, second.id, hidden.id] } },
      data: { contentCheckedAt: new Date('2026-01-01'), tier: 5 },
    });
    const done = async (
      gameId: string,
      at: string,
      opts: { isPublic?: boolean; completion?: number } = {},
    ) => {
      const p = await player(opts.isPublic ?? true);
      await owns(p.id, gameId, { completion: opts.completion ?? 100 });
      await db.userGame.update({
        where: { userId_gameId: { userId: p.id, gameId } },
        data: { lastUnlockedAt: new Date(at) },
      });
      return p;
    };
    const alice = await done(first.id, '2031-01-02T10:00:00Z');
    const bob = await done(second.id, '2031-01-03T10:00:00Z');
    await done(first.id, '2031-01-04T10:00:00Z', { isPublic: false });
    await done(second.id, '2031-01-05T10:00:00Z', { completion: 80 });
    await done(hidden.id, '2031-01-01T10:00:00Z');

    const recent = await partnerRecentCompletions(50, new Date('2031-01-01T12:00:00Z'));
    expect(recent.items.map((item) => [item.user.id, item.game.platformGameId])).toEqual([
      [bob.id, second.platformGameId],
      [alice.id, first.platformGameId],
    ]);
    expect(recent.items[0]).toMatchObject({
      completedAt: '2031-01-03T10:00:00.000Z',
      card: { tier: 5, rank: 'prismatic' },
      user: { handle: bob.handle },
    });
  });
});

describe('appid Steam des autres plateformes', () => {
  it('donne à un jeu PSN l’appid de sa version Steam', async () => {
    const family = appid();
    const steam = await game();
    await db.game.update({ where: { id: steam.id }, data: { familyKey: family } });
    const psn = await db.game.create({
      data: {
        platform: 'PSN',
        platformGameId: appid(),
        name: `${PREFIX} jeu PSN`,
        slug: appid(),
        totalAchievements: 2,
        familyKey: family,
      },
    });
    const alone = await db.game.create({
      data: { platform: 'XBOX', platformGameId: appid(), name: `${PREFIX} Xbox`, slug: appid() },
    });
    expect((await partnerGame('PSN', psn.platformGameId))?.steamAppId).toBe(steam.platformGameId);
    expect((await partnerGame('STEAM', steam.platformGameId))?.steamAppId).toBe(
      steam.platformGameId,
    );
    expect((await partnerGame('XBOX', alone.platformGameId))?.steamAppId).toBeNull();
  });
});

describe('succès d’un jeu sans joueur', () => {
  it('range les plus rares d’abord, garde les secrets et donne le lien des guides', async () => {
    const g = await game();
    const author = await player();
    const make = (id: string, rarity: number, extra = {}) =>
      db.achievement.create({
        data: { gameId: g.id, platformAchievementId: id, name: id, globalRarity: rarity, ...extra },
      });
    const common = await make('COURANT', 80);
    const rare = await make('RARE', 2, { missable: true });
    await make('SECRET', 40, { hidden: true, description: 'La fin' });
    const buried = await make('ENTERRE', 50);
    await db.guide.create({
      data: { achievementId: rare.id, authorId: author.id, contentMd: 'Comment faire' },
    });
    await db.guide.create({
      data: { achievementId: buried.id, authorId: author.id, contentMd: 'Faux', score: -5 },
    });

    const result = await partnerGameAchievements('STEAM', g.platformGameId);
    expect(result?.achievements.map((a) => a.id)).toEqual(['RARE', 'SECRET', 'ENTERRE', 'COURANT']);
    expect(result?.achievements[0]).toMatchObject({
      missable: true,
      guideUrl: expect.stringContaining(`/succes/${rare.id}`),
    });
    expect(result?.achievements[1]).toMatchObject({ name: null, description: null, hidden: true });
    // Un guide enterré par les votes ne compte pas.
    expect(result?.achievements[2]?.guideUrl).toBeNull();
    expect(common.id).toBeTruthy();

    const adult = await game({ adultOnly: true });
    expect(await partnerGameAchievements('STEAM', adult.platformGameId)).toBeNull();
  });
});

describe('plusieurs joueurs en un appel', () => {
  it('rend les profils publics dans l’ordre, par handle ou par id, sans doublon', async () => {
    const a = await player();
    const b = await player();
    const hidden = await player(false);

    const result = await partnerUsersLookup([b.id, a.handle, a.id, hidden.handle, 'inconnu']);
    expect(result.items.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(result.missing).toEqual([hidden.handle, 'inconnu']);
  });

  it('ajoute la progression sur un jeu, null pour qui ne l’a pas', async () => {
    const g = await game();
    const [fan, other] = [await player(), await player()];
    await owns(fan.id, g.id, { completion: 100 });

    const result = await partnerUsersLookup([fan.id, other.id], {
      platform: 'STEAM',
      platformGameId: g.platformGameId,
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: fan.id,
        gameProgress: expect.objectContaining({ completed: true }),
      }),
      expect.objectContaining({ id: other.id, gameProgress: null }),
    ]);
  });
});
