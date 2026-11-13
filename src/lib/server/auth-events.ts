import { db } from './db';
import { logger } from '#lib/logger';

const log = logger('Connexion');

type AuthEventKind = 'START' | 'SIGNUP' | 'LOGIN' | 'ERROR';
export type AuthErrorReason = 'expire' | 'annule' | 'fournisseur' | 'refuse' | 'deja_lie';

const KEEP_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Note une étape du parcours de connexion. Jamais bloquant : une panne de la base ne doit pas
 * empêcher quelqu'un de se connecter, l'étape est simplement perdue.
 */
export async function recordAuthEvent(
  provider: string,
  kind: AuthEventKind,
  reason: AuthErrorReason | null = null,
) {
  try {
    await db.authEvent.create({ data: { provider, kind, reason } });
  } catch (cause) {
    log.warn('suivi de connexion :', cause);
  }
}

/** Les événements de plus de 90 jours s'effacent au balayage horaire, pas à l'affichage. */
export const purgeAuthEvents = (now = new Date()) =>
  db.authEvent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY) } },
  });

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Le suivi des inscriptions pour la modération : les membres, et sur `days` jours, ce que
 * devient chaque départ vers un fournisseur.
 */
export async function signupStats(days = 14, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const [members, week, month, events] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    db.authEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { provider: true, kind: true, reason: true, createdAt: true },
    }),
  ]);

  const empty = () => ({ starts: 0, signups: 0, logins: 0, errors: 0 });
  const add = (row: ReturnType<typeof empty>, kind: string) => {
    if (kind === 'START') row.starts++;
    else if (kind === 'SIGNUP') row.signups++;
    else if (kind === 'LOGIN') row.logins++;
    else row.errors++;
  };

  // Un jour par ligne, du plus récent au plus ancien, même les jours sans rien.
  const byDay = new Map<string, ReturnType<typeof empty>>();
  for (let i = 0; i < days; i++) byDay.set(dayKey(new Date(now.getTime() - i * DAY)), empty());
  const byProvider = new Map<string, ReturnType<typeof empty>>();
  const reasons = new Map<string, number>();
  for (const event of events) {
    const day = byDay.get(dayKey(event.createdAt));
    if (day) add(day, event.kind);
    if (!byProvider.has(event.provider)) byProvider.set(event.provider, empty());
    add(byProvider.get(event.provider)!, event.kind);
    if (event.kind === 'ERROR' && event.reason) {
      reasons.set(event.reason, (reasons.get(event.reason) ?? 0) + 1);
    }
  }

  return {
    members,
    week,
    month,
    days: [...byDay].map(([day, counts]) => ({ day, ...counts })),
    providers: [...byProvider]
      .map(([provider, counts]) => ({ provider, ...counts }))
      .sort((a, b) => b.starts - a.starts),
    reasons: [...reasons]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
