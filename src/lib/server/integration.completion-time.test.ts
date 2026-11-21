// Tests sur un vrai PostgreSQL : les temps du 100 % rattrapés pour les complétions d'avant la collecte.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import {
  backfillCompletionTimes,
  COMPLETION_TIME_DISPLAY_SAMPLE,
  completionTimes,
} from './completion-time';
import { db } from './db';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();

const DAY = 86_400_000;

async function game() {
  const created = await db.game.create({
    data: {
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${crypto.randomUUID()}`,
      name: `${PREFIX} jeu`,
      slug: `${PREFIX}-${crypto.randomUUID()}`,
    },
  });
  await db.achievement.createMany({
    data: ['A', 'B'].map((id) => ({ gameId: created.id, platformAchievementId: id, name: id })),
  });
  return created;
}

/** Un joueur public déjà à 100 %, avec son temps actuel et sa dernière session. */
async function finished(gameId: string, minutes: number, playedAfterDays: number) {
  const user = await db.user.create({
    data: { handle: `${PREFIX}-${crypto.randomUUID()}`, displayName: `${PREFIX} joueur` },
  });
  const lastUnlockedAt = new Date(Date.now() - 300 * DAY);
  await db.userGame.create({
    data: {
      userId: user.id,
      gameId,
      unlockedCount: 2,
      totalCount: 2,
      completion: 100,
      playtimeMinutes: minutes,
      lastUnlockedAt,
      lastPlayedAt: new Date(lastUnlockedAt.getTime() + playedAfterDays * DAY),
    },
  });
  return user;
}

describe('temps du 100 % rattrapés', () => {
  it('reprend les joueurs qui ont arrêté après leur 100 %, et écarte ceux qui ont rejoué', async () => {
    const { id: gameId } = await game();
    for (const minutes of [600, 620, 640, 660]) await finished(gameId, minutes, 0);
    // Rejoué un mois plus tard : ses heures d'après le 100 % fausseraient la mesure.
    await finished(gameId, 9000, 30);

    expect(await backfillCompletionTimes()).toBe(4);
    // Rejouable : rien de neuf la seconde fois.
    expect(await backfillCompletionTimes()).toBe(0);
    expect(
      (await completionTimes([gameId], undefined, undefined, COMPLETION_TIME_DISPLAY_SAMPLE)).get(
        gameId,
      ),
    ).toBeUndefined();

    await finished(gameId, 700, 1);
    expect(await backfillCompletionTimes()).toBe(1);
    // Cinq mesures suffisent pour la fiche ; l'API partenaires et la modération en attendent vingt.
    expect(
      (await completionTimes([gameId], undefined, undefined, COMPLETION_TIME_DISPLAY_SAMPLE)).get(
        gameId,
      ),
    ).toEqual({ median: 640, sample: 5 });
    expect((await completionTimes([gameId])).get(gameId)).toBeUndefined();
  });
});
