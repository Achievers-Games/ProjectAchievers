// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { db } from './db';
import { compareGame } from './queries';
import { blockUser } from './social';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

describe('comparaison par jeu', () => {
  async function player() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    return db.user.findUniqueOrThrow({ where: { id: result.userId } });
  }

  const game = (name = `${PREFIX} comparaison`, familyKey?: string) =>
    db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        familyKey,
      },
    });

  const achievement = (gameId: string, name = `${PREFIX} succès`) =>
    db.achievement.create({
      data: { gameId, platformAchievementId: `${Math.random()}`, name },
    });

  const own = (userId: string, gameId: string, hidden = false) =>
    db.userGame.create({
      data: {
        userId,
        gameId,
        completion: 50,
        unlockedCount: 1,
        totalCount: 2,
        hidden,
      },
    });

  const unlock = (userId: string, achievementId: string) =>
    db.userAchievement.create({ data: { userId, achievementId, unlockedAt: new Date() } });

  it('lit la progression et les succès de l’autre sur la même version', async () => {
    const [me, other] = [await player(), await player()];
    const current = await game();
    const first = await achievement(current.id);
    await achievement(current.id);
    await own(me.id, current.id);
    await own(other.id, current.id);
    await unlock(other.id, first.id);

    const result = await compareGame({
      viewerId: me.id,
      gameId: current.id,
      handle: other.handle,
    });

    expect(result?.user.id).toBe(other.id);
    expect(result?.progress).toEqual({ unlockedCount: 1, totalCount: 2, completion: 50 });
    expect(result?.unlocked).toEqual([first.id]);
  });

  it('ne compare rien quand l’autre ne possède pas cette version', async () => {
    const [me, other] = [await player(), await player()];
    const current = await game();
    await own(me.id, current.id);

    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: other.handle }),
    ).toMatchObject({ progress: null, unlocked: [] });
  });

  it('cache la progression des jeux masqués, succès compris', async () => {
    const [me, other] = [await player(), await player()];
    const current = await game();
    const first = await achievement(current.id);
    await own(me.id, current.id);
    await own(other.id, current.id, true);
    await unlock(other.id, first.id);

    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: other.handle }),
    ).toMatchObject({ progress: null, unlocked: [] });
  });

  it('ne compare pas une autre version de la même famille', async () => {
    const [me, other] = [await player(), await player()];
    const family = `${PREFIX}-famille-${Math.random()}`;
    const current = await game(`${PREFIX} version a`, family);
    const edition = await game(`${PREFIX} version b`, family);
    await own(me.id, current.id);
    await own(other.id, edition.id);

    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: other.handle }),
    ).toMatchObject({ progress: null });
  });

  it('reste muet pour un profil privé, un blocage, soi-même ou un inconnu', async () => {
    const [me, other] = [await player(), await player()];
    const current = await game();
    await own(me.id, current.id);
    await own(other.id, current.id);

    await db.user.update({ where: { id: other.id }, data: { isPublic: false } });
    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: other.handle }),
    ).toBeNull();
    await db.user.update({ where: { id: other.id }, data: { isPublic: true } });

    await blockUser(other.id, me.id);
    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: other.handle }),
    ).toBeNull();
    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: me.handle }),
    ).toBeNull();
    expect(
      await compareGame({ viewerId: me.id, gameId: current.id, handle: `${PREFIX}-inconnu` }),
    ).toBeNull();
  });
});
