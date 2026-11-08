// Tests sur un vrai PostgreSQL : la liaison de comptes entre Achievers et un site partenaire.
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveIdentity, type Identity } from './accounts';
import { db } from './db';
import { issuePartnerKey } from './partner-api';
import {
  activePartnerLinks,
  autoLinkLure,
  findUsersByIdentities,
  LURE,
  unlinkPartner,
} from './partner-link';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { POST } from '../../routes/api/v1/partner/identities/lookup/+server';

setupIntegration();
afterAll(async () => {
  await db.partnerLink.deleteMany({ where: { partner: LURE } });
  await db.partnerApp.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

async function player(overrides: Partial<Identity> = {}) {
  const result = await resolveIdentity(identity(overrides), null);
  if (!result.ok) throw new Error('compte non créé');
  return result.userId;
}

const identitiesOf = (userId: string) =>
  db.linkedAccount.findMany({
    where: { userId },
    select: { provider: true, providerUserId: true },
  });

const lookupRequest = (body: unknown, key: string) =>
  ({
    request: new Request('http://localhost/api/v1/partner/identities/lookup', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    getClientAddress: () => '203.0.113.77',
  }) as unknown as Parameters<typeof POST>[0];

describe('recherche d’identités', () => {
  it('rend le compte qui a vérifié l’identité, et rien pour une inconnue', async () => {
    const userId = await player();
    const accounts = await identitiesOf(userId);

    expect(await findUsersByIdentities(accounts)).toEqual([userId]);
    expect(
      await findUsersByIdentities([{ provider: 'STEAM', providerUserId: `${PREFIX}-personne` }]),
    ).toEqual([]);
  });
});

describe('liaison automatique', () => {
  it('relie quand un seul compte partenaire correspond', async () => {
    const userId = await player();

    expect(await autoLinkLure(userId, async () => ['lure-un'])).toBe(true);
    expect(
      await db.partnerLink.findUnique({
        where: { userId_partner: { userId, partner: LURE } },
        select: { partnerUserId: true, method: true },
      }),
    ).toEqual({ partnerUserId: 'lure-un', method: 'AUTO' });
  });

  it('ne relie pas quand plusieurs comptes partenaires correspondent', async () => {
    const userId = await player();

    expect(await autoLinkLure(userId, async () => ['lure-a', 'lure-b'])).toBe(false);
    expect(await db.partnerLink.count({ where: { userId } })).toBe(0);
  });

  it('ne relie pas quand aucun compte ne correspond', async () => {
    const userId = await player();

    expect(await autoLinkLure(userId, async () => [])).toBe(false);
    expect(await db.partnerLink.count({ where: { userId } })).toBe(0);
  });

  it('dédoublonne une identité rendue deux fois', async () => {
    const userId = await player();

    // Un identifiant à lui : `lure-un` appartient déjà au joueur du premier test.
    expect(await autoLinkLure(userId, async () => ['lure-double', 'lure-double'])).toBe(true);
    expect(await db.partnerLink.count({ where: { userId } })).toBe(1);
  });

  it('ne prend pas le compte partenaire déjà relié à quelqu’un d’autre', async () => {
    const [first, second] = [await player(), await player()];
    await db.partnerLink.create({
      data: { userId: second, partner: LURE, partnerUserId: 'lure-pris', method: 'AUTO' },
    });

    expect(await autoLinkLure(first, async () => ['lure-pris'])).toBe(false);
    expect(await db.partnerLink.count({ where: { userId: first } })).toBe(0);
  });
});

describe('déliaison', () => {
  it('retire le lien du compte, sans toucher aux autres', async () => {
    const [userId, other] = [await player(), await player()];
    await autoLinkLure(userId, async () => ['lure-moi']);
    await autoLinkLure(other, async () => ['lure-autre']);

    await unlinkPartner(userId, LURE);

    expect(await activePartnerLinks(userId)).toEqual([]);
    expect(await activePartnerLinks(other)).toHaveLength(1);
  });

  it('ne relie pas de nouveau à la connexion suivante', async () => {
    const userId = await player();
    await autoLinkLure(userId, async () => ['lure-delie']);
    await unlinkPartner(userId, LURE);

    expect(await autoLinkLure(userId, async () => ['lure-delie'])).toBe(false);
    expect(await activePartnerLinks(userId)).toEqual([]);
  });
});

describe('route de recherche', () => {
  it('rend les comptes qui portent les identités envoyées', async () => {
    const userId = await player();
    const { key } = await issuePartnerKey(`${PREFIX} liaison`);

    const response = await POST(lookupRequest({ identities: await identitiesOf(userId) }, key));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ partnerUserIds: [userId] });
  });

  it('refuse un corps qui n’est pas une liste d’identités connues', async () => {
    const { key } = await issuePartnerKey(`${PREFIX} liaison`);

    const response = await POST(
      lookupRequest({ identities: [{ provider: 'NOPE', providerUserId: 'x' }] }, key),
    );

    expect(response.status).toBe(400);
  });
});
