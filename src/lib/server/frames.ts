import { COLLECTOR_CARDS } from '#lib/frames';
import { db } from './db';
import { allCollectors } from './queries';

const GRANT_EVERY = 30 * 60_000;
let lastGrant = 0;

/**
 * Les synchronisations de compte sont fréquentes, et le classement complet coûte cher :
 * le relire à chaque sync n'apporterait rien de plus qu'une fois par demi-heure.
 */
export async function grantFramesThrottled() {
  if (Date.now() - lastGrant < GRANT_EVERY) return;
  lastGrant = Date.now();
  await grantFrames();
}

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
