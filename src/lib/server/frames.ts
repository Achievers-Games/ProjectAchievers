import { COLLECTOR_CARDS } from '$lib/frames';
import { db } from './db';
import { allCollectors } from './queries';

/** Attribue les cadres mérités. Un cadre obtenu reste acquis, même après avoir quitté le podium. */
export async function grantFrames() {
  const ranking = await allCollectors();

  await db.userFrame.createMany({
    data: ranking.flatMap(({ id: userId, cards }, index) => [
      ...(index < 3 ? [{ userId, frame: `podium-${index + 1}` }] : []),
      ...(cards >= COLLECTOR_CARDS ? [{ userId, frame: 'collector' }] : []),
    ]),
    skipDuplicates: true,
  });
}
