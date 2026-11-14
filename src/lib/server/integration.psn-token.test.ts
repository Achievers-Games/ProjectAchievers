// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Sony n'est jamais joint : un seul NPSSO passe sa vérification.
vi.mock('psn-api', async (original) => ({
  ...(await original<typeof import('psn-api')>()),
  exchangeNpssoForAccessCode: async (npsso: string) => {
    if (npsso !== 'n'.repeat(64))
      throw new Error(
        'Error: There was a problem retrieving your PSN access code. Is your NPSSO code valid?',
      );
    return 'code';
  },
}));

const { db } = await import('./db');
const { psnNpsso, setSavedNpsso } = await import('./psn-npsso');
const { loadSavedNpsso, psnTokenState, savePsnNpsso } = await import('./service-token');
const { availableProviders } = await import('./providers');

const PSN = 'PSN_SERVICE_NPSSO';

beforeEach(async () => {
  setSavedNpsso(undefined);
  await db.serviceToken.deleteMany({ where: { name: PSN } });
});
afterAll(async () => {
  await db.serviceToken.deleteMany({ where: { name: PSN } });
  setSavedNpsso(undefined);
  await db.$disconnect();
});

describe('jeton PSN saisi depuis la modération', () => {
  it('enregistre un jeton accepté par Sony, chiffré, et le met en service aussitôt', async () => {
    expect(await savePsnNpsso('n'.repeat(64))).toBe(true);

    expect(psnNpsso()).toBe('n'.repeat(64));
    expect(availableProviders().PSN).toBe(true);
    const row = await db.serviceToken.findUniqueOrThrow({ where: { name: PSN } });
    expect(row.valueEnc).not.toContain('nnnn');
    const state = await psnTokenState();
    expect(state).toMatchObject({ failing: false });
    expect(state!.daysLeft).toBeGreaterThanOrEqual(59);

    // Au redémarrage, la base fournit le jeton.
    setSavedNpsso(undefined);
    await loadSavedNpsso();
    expect(psnNpsso()).toBe('n'.repeat(64));
  });

  it('refuse un jeton que Sony rejette, et garde le précédent', async () => {
    await savePsnNpsso('n'.repeat(64));
    expect(await savePsnNpsso('x'.repeat(64))).toBe(false);

    expect(psnNpsso()).toBe('n'.repeat(64));
    const row = await db.serviceToken.findUniqueOrThrow({ where: { name: PSN } });
    expect(row.failedAt).toBeNull();
  });
});
