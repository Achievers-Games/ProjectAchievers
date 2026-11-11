// Tests sur un vrai PostgreSQL : le suivi des inscriptions de la page Modération.
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from './db';
import { recordAuthEvent, signupStats } from './auth-events';
import { setupIntegration } from './test-helpers';

setupIntegration();
const PROVIDER = 'zz-test-provider';
afterAll(() => db.authEvent.deleteMany({ where: { provider: PROVIDER } }));

describe('suivi des inscriptions', () => {
  it('compte départs, inscriptions, connexions et échecs par jour et par raison', async () => {
    const now = new Date('2031-03-10T12:00:00Z');
    const at = (iso: string) => new Date(iso);
    await db.authEvent.createMany({
      data: [
        { provider: PROVIDER, kind: 'START', createdAt: at('2031-03-10T08:00:00Z') },
        { provider: PROVIDER, kind: 'START', createdAt: at('2031-03-10T09:00:00Z') },
        { provider: PROVIDER, kind: 'SIGNUP', createdAt: at('2031-03-10T09:01:00Z') },
        {
          provider: PROVIDER,
          kind: 'ERROR',
          reason: 'expire',
          createdAt: at('2031-03-09T10:00:00Z'),
        },
        { provider: PROVIDER, kind: 'LOGIN', createdAt: at('2031-03-09T11:00:00Z') },
        // Trop vieux : effacé, et hors des 14 jours.
        { provider: PROVIDER, kind: 'START', createdAt: at('2030-11-01T10:00:00Z') },
      ],
    });

    const stats = await signupStats(14, now);
    expect(stats.days).toHaveLength(14);
    expect(stats.days[0]).toEqual({
      day: '2031-03-10',
      starts: 2,
      signups: 1,
      logins: 0,
      errors: 0,
    });
    expect(stats.days[1]).toEqual({
      day: '2031-03-09',
      starts: 0,
      signups: 0,
      logins: 1,
      errors: 1,
    });
    expect(stats.providers.find((row) => row.provider === PROVIDER)).toMatchObject({
      starts: 2,
      signups: 1,
      logins: 1,
      errors: 1,
    });
    expect(stats.reasons).toContainEqual({ reason: 'expire', count: 1 });
    expect(
      await db.authEvent.count({
        where: { provider: PROVIDER, createdAt: { lt: at('2031-01-01') } },
      }),
    ).toBe(0);
  });

  it('note une étape avec sa raison, sans rien sur le joueur', async () => {
    await recordAuthEvent(PROVIDER, 'ERROR', 'refuse');
    const row = await db.authEvent.findFirstOrThrow({
      where: { provider: PROVIDER, reason: 'refuse' },
    });
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'kind', 'provider', 'reason']);
  });
});
