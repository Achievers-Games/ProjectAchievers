import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db';
import { issuePartnerKey, revokePartnerKey } from '#lib/server/partner-api';
import { issueWebhookSecret } from '#lib/server/partner-webhooks';
import { isRedirectUri, issueOAuthClient, rotateOAuthSecret } from '#lib/server/oauth-provider';
import { psnTokenState } from '#lib/server/service-token';
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

function requireModerator(locals: App.Locals) {
  if (!locals.user || locals.user.role === 'USER') error(404, m.not_found());
  return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
  const moderator = requireModerator(locals);

  const reports = await db.report.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { reporter: { select: { handle: true } } },
  });

  const guideIds = reports.filter((r) => r.targetType === 'GUIDE').map((r) => r.targetId);
  const commentIds = reports.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);
  const messageIds = reports.filter((r) => r.targetType === 'MESSAGE').map((r) => r.targetId);
  const [guides, comments, messages] = await Promise.all([
    db.guide.findMany({
      where: { id: { in: guideIds } },
      select: {
        id: true,
        title: true,
        contentMd: true,
        achievementId: true,
        game: { select: { slug: true } },
        status: true,
      },
    }),
    db.comment.findMany({
      where: { id: { in: commentIds } },
      select: {
        id: true,
        contentMd: true,
        achievementId: true,
        status: true,
        guide: { select: { id: true, game: { select: { slug: true } } } },
      },
    }),
    // Seul le message signalé est lu, jamais le reste de la discussion.
    db.message.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, content: true },
    }),
  ]);
  // Le lien mène au succès, ou à la page du guide complet du jeu.
  const context = (t: {
    id: string;
    achievementId: string | null;
    game?: { slug: string } | null;
  }) =>
    t.achievementId
      ? `/succes/${t.achievementId}`
      : t.game
        ? `/jeux/${t.game.slug}/guides/${t.id}`
        : null;
  const targets = new Map<string, { contentMd: string; href: string | null }>([
    // Le titre d'un guide de jeu fait partie de ce qui est signalé.
    ...guides.map((t) => {
      const contentMd = [t.title, t.contentMd].filter(Boolean).join('\n\n');
      return [t.id, { contentMd, href: context(t) }] as const;
    }),
    // Un commentaire de guide mène au guide qu'il commente.
    ...comments.map((t) => {
      const href = t.guide ? context({ ...t.guide, achievementId: null }) : context(t);
      return [t.id, { contentMd: t.contentMd, href }] as const;
    }),
    ...messages.map((t) => [t.id, { contentMd: t.content, href: null }] as const),
  ]);

  // Les familles de plusieurs jeux : c'est là que le rapprochement par titre peut se tromper.
  const shared = await db.game.groupBy({
    by: ['familyKey'],
    where: { familyKey: { not: null } },
    _count: { _all: true },
    having: { familyKey: { _count: { gt: 1 } } },
    orderBy: { familyKey: 'asc' },
    take: 200,
  });
  const familyGames = await db.game.findMany({
    where: { familyKey: { in: shared.map((f) => f.familyKey as string) } },
    orderBy: { platform: 'asc' },
    select: { id: true, name: true, slug: true, platform: true, familyKey: true },
  });
  const families = shared.map((family) => ({
    key: family.familyKey as string,
    games: familyGames.filter((game) => game.familyKey === family.familyKey),
  }));

  const feedback = await db.feedback.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      kind: true,
      area: true,
      status: true,
      content: true,
      userAgent: true,
      createdAt: true,
      user: { select: { handle: true, displayName: true } },
    },
  });

  // Les emblèmes sur lesquels l'analyse automatique n'a pas su trancher.
  const emblems = await db.clan.findMany({
    where: { imagePending: true, imageAt: { not: null } },
    orderBy: { imageAt: 'asc' },
    take: 50,
    select: { id: true, name: true, slug: true, imageAt: true },
  });

  return {
    emblems: emblems.map((clan) => ({
      ...clan,
      url: `/clans/${clan.slug}/image?v=${clan.imageAt!.getTime()}`,
    })),
    // Le jeton du site ne regarde que les administrateurs, qui le renouvellent.
    psnToken: moderator.role === 'ADMIN' ? await psnTokenState() : undefined,
    // Les clés de l'API partenaire aussi : elles ouvrent les données du site à un autre.
    partners:
      moderator.role === 'ADMIN'
        ? (
            await db.partnerApp.findMany({
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
                keyPrefix: true,
                createdAt: true,
                lastUsedAt: true,
                revokedAt: true,
                slug: true,
                webhookUrl: true,
                webhookSecret: true,
                webhookFailures: true,
                webhookLastAttemptAt: true,
                webhookLastError: true,
                oauthClientId: true,
                oauthRedirectUris: true,
              },
            })
          ).map(({ webhookSecret, ...partner }) => ({
            ...partner,
            // Le secret chiffré ne quitte pas le serveur : la page sait seulement s'il existe.
            hasWebhookSecret: webhookSecret !== null,
          }))
        : undefined,
    feedback,
    families,
    reports: reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      reporter: report.reporter.handle,
      targetType: report.targetType,
      createdAt: report.createdAt,
      target: targets.get(report.targetId) ?? null,
    })),
  };
};

const feedbackStatus = z.enum(['NEW', 'PLANNED', 'DONE', 'DECLINED']);

function requireAdmin(locals: App.Locals) {
  const user = requireModerator(locals);
  if (user.role !== 'ADMIN') error(404, m.not_found());
  return user;
}

const partnerName = z.string().trim().min(2).max(40);

/** Seule une adresse HTTPS reçoit les succès : ils ne doivent pas circuler en clair. */
const partnerWebhook = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([a-z0-9-]{2,30})?$/),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value === '' || /^https:\/\/[^\s]+$/.test(value)),
});

export const actions: Actions = {
  /** Crée la clé d'un partenaire, ou la remplace : elle ne s'affiche qu'une fois. */
  partnerKey: async ({ request, locals }) => {
    requireAdmin(locals);
    const name = partnerName.safeParse((await request.formData()).get('name'));
    if (!name.success) return fail(400, { error: m.action_failed() });
    const { key } = await issuePartnerKey(name.data);
    return { partnerKey: key, partnerName: name.data };
  },

  partnerRevoke: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = String((await request.formData()).get('id'));
    await revokePartnerKey(id).catch(() => null);
  },

  /**
   * Relie le partenaire à ses joueurs (`slug`, comme dans `PartnerLink`) et à son adresse de
   * webhook. Le premier enregistrement d'une adresse crée le secret de signature, montré une fois.
   */
  partnerWebhook: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const parsed = partnerWebhook.safeParse({
      id: form.get('id'),
      slug: form.get('slug'),
      url: form.get('url'),
    });
    if (!parsed.success) return fail(400, { error: m.mod_partner_webhook_invalid() });
    const { id, slug, url } = parsed.data;
    const app = await db.partnerApp
      .update({
        where: { id },
        data: { slug: slug || null, webhookUrl: url || null, webhookFailures: 0 },
        select: { id: true, name: true, webhookSecret: true },
      })
      .catch(() => null);
    if (!app) return fail(400, { error: m.mod_partner_webhook_invalid() });
    if (url && !app.webhookSecret) {
      return { webhookSecret: await issueWebhookSecret(app.id), partnerName: app.name };
    }
  },

  /**
   * Les adresses de retour OAuth du partenaire. La première fois, crée aussi son identifiant
   * client et son secret, montrés une seule fois ; ensuite, seules les adresses changent.
   */
  partnerOAuth: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const uris = String(form.get('uris') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    if (uris.length === 0 || uris.length > 10 || !uris.every(isRedirectUri)) {
      return fail(400, { error: m.mod_partner_oauth_invalid() });
    }
    const app = await db.partnerApp.findUnique({
      where: { id },
      select: { id: true, name: true, oauthClientId: true },
    });
    if (!app) return fail(400, { error: m.action_failed() });
    if (app.oauthClientId) {
      await db.partnerApp.update({ where: { id }, data: { oauthRedirectUris: uris } });
      return;
    }
    const client = await issueOAuthClient(app.id, uris);
    return { oauthClient: client, partnerName: app.name };
  },

  /** Un nouveau secret client, même identifiant : l'ancien cesse de valoir aussitôt. */
  partnerOAuthSecret: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = String((await request.formData()).get('id') ?? '');
    const app = await db.partnerApp.findUnique({
      where: { id },
      select: { id: true, name: true, oauthClientId: true },
    });
    if (!app?.oauthClientId) return fail(400, { error: m.action_failed() });
    const clientSecret = await rotateOAuthSecret(app.id);
    return {
      oauthClient: { clientId: app.oauthClientId, clientSecret },
      partnerName: app.name,
    };
  },

  /** Un nouveau secret de signature : l'ancien cesse de valoir aussitôt. */
  partnerWebhookSecret: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = String((await request.formData()).get('id'));
    const app = await db.partnerApp.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!app) return fail(400, { error: m.action_failed() });
    return { webhookSecret: await issueWebhookSecret(app.id), partnerName: app.name };
  },

  feedback: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const status = feedbackStatus.safeParse(form.get('status'));
    if (!status.success) return fail(400, { error: m.action_failed() });
    await db.feedback.updateMany({
      where: { id: String(form.get('id')) },
      data: { status: status.data },
    });
  },

  emblem: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const id = String(form.get('id'));
    await db.clan.updateMany({
      where: { id, imagePending: true },
      data:
        form.get('keep') === '1'
          ? { imagePending: false }
          : { image: null, imageType: null, imageAt: null, imagePending: false },
    });
  },

  separate: async ({ request, locals }) => {
    requireModerator(locals);
    const id = String((await request.formData()).get('id'));
    await db.game.updateMany({
      where: { id },
      data: { familyKey: `seul-${id}`, familyLocked: true },
    });
  },

  join: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const [first, second] = await Promise.all(
      ['first', 'second'].map((name) =>
        db.game.findUnique({ where: { slug: String(form.get(name)).trim() } }),
      ),
    );
    if (!first || !second) return fail(404, { error: m.mod_game_missing() });

    const familyKey = first.familyKey ?? first.id;
    await db.game.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { familyKey, familyLocked: true },
    });
  },

  resolve: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const report = await db.report.findUnique({ where: { id: String(form.get('id')) } });
    if (!report) return fail(404, { error: m.mod_report_missing() });

    await db.$transaction(async (tx) => {
      if (form.get('hide') === '1') {
        if (report.targetType === 'MESSAGE') {
          await tx.message.deleteMany({ where: { id: report.targetId } });
        } else if (report.targetType === 'GUIDE') {
          await tx.guide.updateMany({ where: { id: report.targetId }, data: { status: 'HIDDEN' } });
        } else {
          await tx.comment.updateMany({
            where: { id: report.targetId },
            data: { status: 'HIDDEN' },
          });
        }
      }
      await tx.report.updateMany({
        where: { targetType: report.targetType, targetId: report.targetId, resolvedAt: null },
        data: { resolvedAt: new Date(), upheld: form.get('hide') === '1' },
      });
    });
  },
};
