import { db } from './db';
import { env } from './env';
import { logger } from '#lib/logger';

const log = logger('Image de clan');

/** Le navigateur réduit l'image avant l'envoi : au-delà, ce n'est pas un emblème. */
const MAX_IMAGE_BYTES = 300_000;
const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CHECK_TIMEOUT = 30_000;
const QUESTION =
  'You moderate profile pictures on a gaming website used by teenagers. Does this image show ' +
  'nudity, sexual content, gore, graphic violence against people, hate symbols or drug use? ' +
  'Answer with exactly one word: UNSAFE if it does, SAFE otherwise.';

/** Reconnaît le format à ses premiers octets : le nom et le type annoncés ne prouvent rien. */
export function imageType(bytes: Uint8Array) {
  const starts = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

type ImageVerdict = 'safe' | 'unsafe' | 'unsure';

async function askModel(bytes: Uint8Array, prompt: string) {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN } = env();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_AI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        prompt === 'agree' ? { prompt } : { prompt, image: [...bytes], max_tokens: 5 },
      ),
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    },
  );
  const data = (await response.json().catch(() => ({}))) as {
    result?: { response?: string };
    errors?: { message?: string }[];
  };
  return { ok: response.ok, answer: data.result?.response ?? '', errors: data.errors ?? [] };
}

/**
 * Fait regarder l'image par un modèle de vision. Dans le doute, ou sans le service,
 * l'emblème n'est pas publié : il attend qu'un modérateur le voie.
 */
export async function checkImage(bytes: Uint8Array): Promise<ImageVerdict> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN } = env();
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_TOKEN) return 'unsure';
  try {
    let reply = await askModel(bytes, QUESTION);
    // Le modèle de Meta demande une fois d'accepter sa licence.
    if (!reply.ok && reply.errors.some((error) => /agree/i.test(error.message ?? ''))) {
      await askModel(bytes, 'agree');
      reply = await askModel(bytes, QUESTION);
    }
    const word = reply.answer.trim().toUpperCase();
    if (word.startsWith('UNSAFE')) return 'unsafe';
    if (word.startsWith('SAFE')) return 'safe';
    return 'unsure';
  } catch (cause) {
    log.error('Analyse d’image :', cause);
    return 'unsure';
  }
}

export type ImageFailure = 'owner_only' | 'image_invalid' | 'image_too_big' | 'image_refused';

/** Le chef change l'emblème : publié tout de suite s'il est sûr, mis de côté s'il y a un doute. */
export async function setClanImage(
  userId: string,
  file: File,
): Promise<{ failure: ImageFailure } | { pending: boolean }> {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (membership?.role !== 'OWNER') return { failure: 'owner_only' };
  if (file.size > MAX_IMAGE_BYTES) return { failure: 'image_too_big' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return { failure: 'image_invalid' };

  const verdict = await checkImage(bytes);
  if (verdict === 'unsafe') return { failure: 'image_refused' };
  await db.clan.update({
    where: { id: membership.clanId },
    data: {
      image: Buffer.from(bytes),
      imageType: type,
      imageAt: new Date(),
      imagePending: verdict === 'unsure',
    },
    select: { id: true },
  });
  return { pending: verdict === 'unsure' };
}

export async function removeClanImage(userId: string) {
  const membership = await db.clanMember.findUnique({ where: { userId } });
  if (membership?.role !== 'OWNER') return 'owner_only' as const;
  await db.clan.update({
    where: { id: membership.clanId },
    data: { image: null, imageType: null, imageAt: null, imagePending: false },
    select: { id: true },
  });
  return null;
}

/** L'adresse de l'emblème, tant qu'il est publié ; la date change l'adresse à chaque envoi. */
export const clanImageUrl = (clan: {
  slug: string;
  imageAt: Date | null;
  imagePending: boolean;
}) =>
  clan.imageAt && !clan.imagePending
    ? `/clans/${clan.slug}/image?v=${clan.imageAt.getTime()}`
    : null;
