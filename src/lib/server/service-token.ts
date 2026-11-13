import { createHash } from 'node:crypto';
import { db } from './db';
import { notify } from './push';
import { m } from '#lib/paraglide/messages';

const PSN = 'PSN_SERVICE_NPSSO';
const DAY = 24 * 60 * 60 * 1000;
/** Sony annonce 60 jours ; le jeton peut mourir avant, d'où l'alerte d'échec. */
const LIFETIME = 60 * DAY;
/** Assez tôt pour le renouveler sans se presser. */
const WARN_BEFORE = 21 * DAY;

const fingerprint = (token: string) =>
  createHash('sha256').update(token).digest('hex').slice(0, 16);

/** Note chaque échange du NPSSO ; un nouveau jeton remet le compte à zéro. */
export async function notePsnToken(token: string, error?: string, now = new Date()) {
  const print = fingerprint(token);
  const outcome = error
    ? { failedAt: now, error: error.slice(0, 300) }
    : { okAt: now, failedAt: null, error: null };
  const current = await db.serviceToken.findUnique({ where: { name: PSN } });
  if (current?.fingerprint === print) {
    await db.serviceToken.update({ where: { name: PSN }, data: outcome });
  } else {
    const data = { fingerprint: print, since: now, okAt: null, ...outcome };
    await db.serviceToken.upsert({
      where: { name: PSN },
      create: { name: PSN, ...data },
      update: data,
    });
  }
}

interface TokenState {
  since: Date;
  expiresAt: Date;
  daysLeft: number;
  failing: boolean;
  warn: boolean;
}

export async function psnTokenState(now = Date.now()): Promise<TokenState | null> {
  const token = await db.serviceToken.findUnique({ where: { name: PSN } });
  if (!token) return null;
  const expiresAt = new Date(token.since.getTime() + LIFETIME);
  const failing = token.failedAt !== null;
  return {
    since: token.since,
    expiresAt,
    daysLeft: Math.max(0, Math.floor((expiresAt.getTime() - now) / DAY)),
    failing,
    warn: failing || expiresAt.getTime() - now <= WARN_BEFORE,
  };
}

/** Prévient les administrateurs une fois par étape : bientôt expiré, puis refusé. */
export async function warnPsnToken(now = Date.now()) {
  const state = await psnTokenState(now);
  if (!state?.warn) return;
  const token = await db.serviceToken.findUniqueOrThrow({ where: { name: PSN } });
  const key = `jeton:${token.fingerprint}:${state.failing ? 'refuse' : 'bientot'}`;
  const { count } = await db.announcement.createMany({ data: [{ key }], skipDuplicates: true });
  if (count === 0) return;
  const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  for (const admin of admins) {
    notify(admin.id, 'digest', key, (locale) => ({
      title: m.mod_psn_token({}, { locale }),
      body: state.failing
        ? m.mod_psn_token_failing({}, { locale })
        : m.mod_psn_token_soon({ days: state.daysLeft }, { locale }),
      url: '/moderation',
    }));
  }
}
