// Tests sur un vrai PostgreSQL : l'envoi des nouveaux succès aux sites partenaires.
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { db } from './db';
import { issuePartnerKey } from './partner-api';
import {
  deliverPartnerWebhooks,
  issueWebhookSecret,
  queueAccountEvent,
  signWebhook,
} from './partner-webhooks';
import { unlinkPartner } from './partner-link';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();
const SLUG = 'zz-test-lure';
afterAll(async () => {
  await db.partnerLink.deleteMany({ where: { partner: SLUG } });
  await db.partnerApp.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

interface Sent {
  url: string;
  body: string;
  signature: string;
}

/** Un faux serveur partenaire : il garde ce qu'il reçoit et répond le code demandé. */
function fakePartner(status = 200) {
  const sent: Sent[] = [];
  const send = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      body: String(init.body),
      signature: (init.headers as Record<string, string>)['X-Achievers-Signature']!,
    });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { sent, send };
}

async function player(isPublic = true) {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  return db.user.update({ where: { id: result.userId }, data: { isPublic } });
}

const at = (iso: string) => new Date(iso);
let counter = 0;

async function setup() {
  await db.partnerApp.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.partnerLink.deleteMany({ where: { partner: SLUG } });
  const { app } = await issuePartnerKey(`${PREFIX} webhooks`);
  await db.partnerApp.update({
    where: { id: app.id },
    data: {
      slug: SLUG,
      webhookUrl: 'https://lure.test/hooks',
      webhookCursor: at('2026-03-01T00:00:00Z'),
    },
  });
  const secret = await issueWebhookSecret(app.id);
  const game = await db.game.create({
    data: {
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${++counter}-${Math.random()}`,
      name: `${PREFIX} jeu webhooks`,
      slug: `${PREFIX}-webhooks-${counter}-${Math.random().toString(36).slice(2)}`,
      totalAchievements: 2,
    },
  });
  const achievements = await Promise.all(
    ['UN', 'DEUX'].map((id) =>
      db.achievement.create({ data: { gameId: game.id, platformAchievementId: id, name: id } }),
    ),
  );
  return { app, secret, game, achievements };
}

/** Un joueur qui débloque un succès, arrivé sur le site à l'instant donné. */
async function unlock(
  userId: string,
  gameId: string,
  achievementId: string,
  arrived: Date,
  completion = 50,
) {
  await db.userGame.upsert({
    where: { userId_gameId: { userId, gameId } },
    create: { userId, gameId, unlockedCount: 1, totalCount: 2, completion },
    update: { completion },
  });
  await db.userAchievement.create({
    data: { userId, achievementId, unlockedAt: at('2026-02-28T20:00:00Z'), createdAt: arrived },
  });
}

describe('webhooks partenaires', () => {
  beforeEach(() => {
    counter++;
  });

  it('envoie, signés, les succès des joueurs reliés et publics seulement', async () => {
    const { secret, game, achievements } = await setup();
    const [linked, stranger, hidden] = [await player(), await player(), await player(false)];
    for (const user of [linked, hidden]) {
      await db.partnerLink.create({
        data: { userId: user.id, partner: SLUG, partnerUserId: `lure-${user.id}`, method: 'AUTO' },
      });
    }
    const arrived = at('2026-03-01T10:00:00Z');
    for (const user of [linked, stranger, hidden]) {
      await unlock(user.id, game.id, achievements[0]!.id, arrived);
    }

    const partner = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T10:05:00Z'), partner.send);

    expect(partner.sent).toHaveLength(1);
    const [delivery] = partner.sent;
    const payload = JSON.parse(delivery!.body) as {
      events: { type: string; user: { partnerUserId: string }; achievements: { id: string }[] }[];
    };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      type: 'achievements.unlocked',
      user: { partnerUserId: `lure-${linked.id}` },
      game: { platform: 'steam', platformGameId: game.platformGameId },
      achievements: [{ id: 'UN' }],
      progress: { completion: 50, completed: false },
    });

    // Le partenaire vérifie la signature avec le secret reçu une fois, rien d'autre.
    const [, timestamp] = /t=(\d+)/.exec(delivery!.signature)!;
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${delivery!.body}`)
      .digest('hex');
    expect(delivery!.signature).toBe(`t=${timestamp},v1=${expected}`);
    expect(signWebhook(secret, delivery!.body, Number(timestamp))).toBe(delivery!.signature);

    // Le curseur a avancé : rien ne repart au tour suivant.
    const again = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T10:06:00Z'), again.send);
    expect(again.sent).toHaveLength(0);
  });

  it('annonce le 100 % et ne dit rien d’un jeu masqué ou d’un lien délié', async () => {
    const { game, achievements } = await setup();
    const [done, masked, unlinked] = [await player(), await player(), await player()];
    for (const user of [done, masked, unlinked]) {
      await db.partnerLink.create({
        data: { userId: user.id, partner: SLUG, partnerUserId: `lure-${user.id}`, method: 'AUTO' },
      });
    }
    await db.partnerLink.update({
      where: { userId_partner: { userId: unlinked.id, partner: SLUG } },
      data: { revokedAt: new Date() },
    });
    const arrived = at('2026-03-01T11:00:00Z');
    await unlock(done.id, game.id, achievements[1]!.id, arrived, 100);
    await unlock(masked.id, game.id, achievements[1]!.id, arrived);
    await db.userGame.update({
      where: { userId_gameId: { userId: masked.id, gameId: game.id } },
      data: { hidden: true },
    });
    await unlock(unlinked.id, game.id, achievements[1]!.id, arrived);

    const partner = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T11:05:00Z'), partner.send);
    const events = (
      JSON.parse(partner.sent[0]!.body) as {
        events: { type: string; user: { partnerUserId: string } }[];
      }
    ).events;
    expect(events).toEqual([
      expect.objectContaining({
        type: 'game.completed',
        user: expect.objectContaining({ partnerUserId: `lure-${done.id}` }),
      }),
    ]);
  });

  it('suit aussi le joueur qui a autorisé le partenaire par OAuth, même au profil privé', async () => {
    const { app, game, achievements } = await setup();
    const [authorised, readOnly] = [await player(false), await player(false)];
    await db.oAuthGrant.create({
      data: { userId: authorised.id, appId: app.id, scopes: ['profile', 'library'] },
    });
    // Sans la portée library, le partenaire n'a pas demandé à suivre la bibliothèque.
    await db.oAuthGrant.create({
      data: { userId: readOnly.id, appId: app.id, scopes: ['profile'] },
    });
    const arrived = at('2026-03-01T13:00:00Z');
    await unlock(authorised.id, game.id, achievements[0]!.id, arrived);
    await unlock(readOnly.id, game.id, achievements[0]!.id, arrived);

    const partner = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T13:05:00Z'), partner.send);
    const events = (
      JSON.parse(partner.sent[0]!.body) as {
        events: { user: { id: string; handle: string; partnerUserId: string | null } }[];
      }
    ).events;
    expect(events.map((event) => event.user)).toEqual([
      {
        id: authorised.id,
        handle: authorised.handle,
        isPublic: false,
        avatarUrl: null,
        partnerUserId: null,
      },
    ]);
  });

  it('retente après un échec, en attendant de plus en plus longtemps', async () => {
    const { app, game, achievements } = await setup();
    const user = await player();
    await db.partnerLink.create({
      data: { userId: user.id, partner: SLUG, partnerUserId: 'lure-panne', method: 'AUTO' },
    });
    await unlock(user.id, game.id, achievements[0]!.id, at('2026-03-01T12:00:00Z'));

    const down = fakePartner(503);
    await deliverPartnerWebhooks(at('2026-03-01T12:01:00Z'), down.send);
    expect(down.sent).toHaveLength(1);
    expect(await db.partnerApp.findUnique({ where: { id: app.id } })).toMatchObject({
      webhookFailures: 1,
      webhookLastError: 'HTTP 503',
      webhookCursor: at('2026-03-01T00:00:00Z'),
    });

    // Trente secondes plus tard : trop tôt, on n'insiste pas.
    const early = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T12:01:30Z'), early.send);
    expect(early.sent).toHaveLength(0);

    // Après l'attente, le même succès repart, et tout revient à la normale.
    const back = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T12:03:00Z'), back.send);
    expect(back.sent).toHaveLength(1);
    expect(await db.partnerApp.findUnique({ where: { id: app.id } })).toMatchObject({
      webhookFailures: 0,
      webhookLastError: null,
    });
  });

  it('commence à maintenant au premier branchement, sans renvoyer l’historique', async () => {
    const { app } = await setup();
    await db.partnerApp.update({ where: { id: app.id }, data: { webhookCursor: null } });
    const partner = fakePartner();
    const now = at('2026-03-02T00:00:00Z');
    await deliverPartnerWebhooks(now, partner.send);
    expect(partner.sent).toHaveLength(0);
    expect((await db.partnerApp.findUnique({ where: { id: app.id } }))?.webhookCursor).toEqual(now);
  });

  it('garde les mêmes id d’événements quand un envoi est retenté', async () => {
    const { game, achievements } = await setup();
    const user = await player();
    await db.partnerLink.create({
      data: { userId: user.id, partner: SLUG, partnerUserId: 'lure-stable', method: 'AUTO' },
    });
    await unlock(user.id, game.id, achievements[0]!.id, at('2026-03-01T14:00:00Z'));

    const failing = fakePartner(500);
    await deliverPartnerWebhooks(at('2026-03-01T14:01:00Z'), failing.send);
    const retry = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-01T14:03:00Z'), retry.send);

    // Le lot raté et le lot renvoyé portent les mêmes id : Lure peut ignorer le doublon.
    const ids = (body: string) =>
      (JSON.parse(body) as { events: { id: string }[] }).events.map((event) => event.id);
    expect(ids(failing.sent[0]!.body)).toHaveLength(1);
    expect(ids(retry.sent[0]!.body)).toEqual(ids(failing.sent[0]!.body));
  });

  it('prévient le partenaire qu’un compte est relié, puis délié', async () => {
    await setup();
    const user = await player();
    await db.partnerLink.create({
      data: { userId: user.id, partner: SLUG, partnerUserId: 'lure-relie', method: 'AUTO' },
    });
    await queueAccountEvent(user.id, 'user.linked', {
      app: { slug: SLUG },
      via: 'AUTO',
      partnerUserId: 'lure-relie',
    });

    const linked = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-02T10:00:00Z'), linked.send);
    const [event] = (JSON.parse(linked.sent[0]!.body) as { events: Record<string, unknown>[] })
      .events;
    expect(event).toMatchObject({
      type: 'user.linked',
      via: 'auto',
      user: { id: user.id, handle: user.handle, isPublic: true, partnerUserId: 'lure-relie' },
    });

    await unlinkPartner(user.id, SLUG);
    const unlinked = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-02T10:01:00Z'), unlinked.send);
    const events = (JSON.parse(unlinked.sent[0]!.body) as { events: Record<string, unknown>[] })
      .events;
    // Le lien n'existe plus, mais le partenaire sait quel compte retirer.
    expect(events).toEqual([
      expect.objectContaining({
        type: 'user.unlinked',
        user: expect.objectContaining({ partnerUserId: 'lure-relie' }),
      }),
    ]);

    // Ce qui est arrivé ne repart pas.
    const quiet = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-02T10:02:00Z'), quiet.send);
    expect(quiet.sent).toHaveLength(0);
  });

  it('ne garde qu’un user.updated en attente, qui décrit l’état actuel', async () => {
    await setup();
    const user = await player();
    await db.partnerLink.create({
      data: { userId: user.id, partner: SLUG, partnerUserId: 'lure-maj', method: 'AUTO' },
    });
    await queueAccountEvent(user.id, 'user.updated');
    await db.user.update({ where: { id: user.id }, data: { isPublic: false } });
    await queueAccountEvent(user.id, 'user.updated');

    const partner = fakePartner();
    await deliverPartnerWebhooks(at('2026-03-03T10:00:00Z'), partner.send);
    const events = (JSON.parse(partner.sent[0]!.body) as { events: Record<string, unknown>[] })
      .events;
    expect(events).toEqual([
      expect.objectContaining({
        type: 'user.updated',
        user: expect.objectContaining({ isPublic: false }),
      }),
    ]);
  });

  it('ne note rien pour un joueur qu’aucun partenaire ne suit', async () => {
    await setup();
    const stranger = await player();
    await queueAccountEvent(stranger.id, 'user.updated');
    expect(await db.partnerEvent.count({ where: { userId: stranger.id } })).toBe(0);
  });
});
