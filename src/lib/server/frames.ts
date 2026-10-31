import { COLLECTOR_CARDS } from '$lib/frames';
import { db } from './db';
import { collectors } from './queries';

/** Attribue les cadres mérités. Un cadre obtenu reste acquis, même après avoir quitté le podium. */
export async function grantFrames() {
  const ranking = await collectors(Number.MAX_SAFE_INTEGER);
  const users = await db.user.findMany({
    where: { handle: { in: ranking.map((row) => row.handle) } },
    select: { id: true, handle: true },
  });
  const ids = new Map(users.map((user) => [user.handle, user.id]));

  await db.userFrame.createMany({
    data: ranking.flatMap((row, index) => {
      const userId = ids.get(row.handle);
      if (!userId) return [];
      return [
        ...(index < 3 ? [{ userId, frame: `podium-${index + 1}` }] : []),
        ...(row.cards >= COLLECTOR_CARDS ? [{ userId, frame: 'collector' }] : []),
      ];
    }),
    skipDuplicates: true,
  });
}
