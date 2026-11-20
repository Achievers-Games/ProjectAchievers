import { db } from './db';
import { imageType } from './clan-image';
import { publishSteamReview } from './sync/store';

/** Une capture réduite par le navigateur (1600 px de large) tient largement là-dedans. */
const MAX_PROOF_BYTES = 1_500_000;
/** Seules les dernières preuves d'une revue sont gardées : les modérateurs n'en lisent pas plus. */
const KEPT_PROOFS = 3;
export const PROOF_MESSAGE_MAX = 500;

export type ProofFailure = 'proof_closed' | 'proof_invalid' | 'proof_too_big';

/**
 * Le joueur défend un lot en attente (suspendu automatiquement compris) : une capture de sa
 * progression ailleurs, et un mot. Une décision de modérateur est définitive : la remise à zéro
 * reste alors la seule voie. La revue repasse sous les yeux des modérateurs.
 */
export async function addSteamProof(
  userId: string,
  gameId: string,
  message: string,
  file: File | null,
): Promise<{ ok: true } | { ok: false; reason: ProofFailure }> {
  const review = await db.steamIntegrityReview.findFirst({
    where: { userId, gameId, status: 'PENDING' },
    select: { id: true },
  });
  if (!review) return { ok: false, reason: 'proof_closed' };

  let image: { bytes: Uint8Array<ArrayBuffer>; type: string } | null = null;
  if (file && file.size) {
    if (file.size > MAX_PROOF_BYTES) return { ok: false, reason: 'proof_too_big' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type) return { ok: false, reason: 'proof_invalid' };
    image = { bytes, type };
  }
  const text = message.trim().slice(0, PROOF_MESSAGE_MAX);
  if (!text && !image) return { ok: false, reason: 'proof_invalid' };

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.steamReviewProof.create({
      data: {
        reviewId: review.id,
        userId,
        message: text,
        image: image?.bytes ?? null,
        imageType: image?.type ?? null,
        createdAt: now,
      },
    });
    const old = await tx.steamReviewProof.findMany({
      where: { reviewId: review.id },
      orderBy: { createdAt: 'desc' },
      skip: KEPT_PROOFS,
      select: { id: true },
    });
    if (old.length)
      await tx.steamReviewProof.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    await tx.steamIntegrityReview.update({ where: { id: review.id }, data: { proofAt: now } });
  });
  await publishSteamReview(userId);
  return { ok: true };
}
