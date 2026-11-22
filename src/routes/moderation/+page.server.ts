import { error, fail } from '@sveltejs/kit';
import { signupStats } from '#lib/server/auth-events';
import { z } from 'zod';
import { db } from '#lib/server/db';
import { issuePartnerKey, revokePartnerKey } from '#lib/server/partner-api';
import { issueWebhookSecret } from '#lib/server/partner-webhooks';
import { isRedirectUri, issueOAuthClient, rotateOAuthSecret } from '#lib/server/oauth-provider';
import { psnTokenState, savePsnNpsso } from '#lib/server/service-token';
import { requireModerator } from '#lib/server/moderator';
import {
  corroboratedGames,
  heldSteamUnlocks,
  steamAchievementId,
  steamReviewUnlocks,
  steamUnlockKey,
  type SteamTrust,
} from '#lib/server/steam-integrity';
import { recheckBlockedSteam } from '#lib/server/sync/live';
import { resolveSteamReview } from '#lib/server/sync/store';
import { logger } from '#lib/logger';

const log = logger('Modération');
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

const STEAM_PAGE_SIZE = 50;

/** Les signalements ouverts, avec le contenu visé et le lien qui y mène. */
async function loadReports() {
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
        profile: { select: { handle: true } },
        unlock: { select: { achievementId: true, user: { select: { handle: true } } } },
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
      const href = t.unlock
        ? unlockHref(t.unlock.user.handle, t.unlock.achievementId)
        : t.profile
          ? `/u/${t.profile.handle}#discussion`
          : context(t.guide ? { ...t.guide, achievementId: null } : t);
      return [t.id, { contentMd: t.contentMd, href }] as const;
    }),
    ...messages.map((t) => [t.id, { contentMd: t.content, href: null }] as const),
  ]);
  return reports.map((report) => ({
    id: report.id,
    reason: report.reason,
    reporter: report.reporter.handle,
    targetType: report.targetType,
    createdAt: report.createdAt,
    target: targets.get(report.targetId) ?? null,
  }));
}

/** La file des dossiers Steam demandée, sa page, et le détail des dossiers de cette page. */
async function loadSteamQueue(url: URL) {
  const queueRows = await db.steamIntegrityReview.findMany({
    where: { OR: [{ status: 'PENDING' }, { status: 'REJECTED', suspendedAt: { not: null } }] },
    select: {
      id: true,
      gameId: true,
      steamId: true,
      status: true,
      suspendedAt: true,
      openedAt: true,
      proofAt: true,
      flagged: true,
      reviewOnly: true,
      game: {
        select: {
          name: true,
          platformGameId: true,
          totalAchievements: true,
          allowSteamBatches: true,
          crossProgress: true,
        },
      },
    },
  });
  const pending = queueRows.filter((review) => review.status === 'PENDING');
  const byPlayer = Map.groupBy(
    pending.map((review) => ({ ...review, flagged: heldSteamUnlocks(review) })),
    (review) => review.steamId,
  );
  const related = new Map(
    pending.map((review) => [
      review.id,
      corroboratedGames(byPlayer.get(review.steamId) ?? [], review.gameId).filter(
        (gameId) => gameId !== review.gameId,
      ).length,
    ]),
  );
  const queues = {
    pending,
    proof: pending.filter((review) => review.proofAt),
    automatic: pending.filter((review) => review.suspendedAt),
    blocked: queueRows.filter((review) => review.status === 'REJECTED'),
  };
  const requestedQueue = url.searchParams.get('steamQueue');
  const requestedReview = url.searchParams.get('steamReview');
  const focus = requestedReview ? queueRows.find((review) => review.id === requestedReview) : null;
  const steamQueue: keyof typeof queues =
    requestedQueue === 'proof' || requestedQueue === 'automatic' || requestedQueue === 'blocked'
      ? requestedQueue
      : focus?.status === 'REJECTED'
        ? 'blocked'
        : 'pending';
  const selected = queues[steamQueue].toSorted(
    (a, b) =>
      Number(Boolean(b.proofAt)) - Number(Boolean(a.proofAt)) ||
      Number(Boolean(b.suspendedAt)) - Number(Boolean(a.suspendedAt)) ||
      (related.get(b.id) ?? 0) - (related.get(a.id) ?? 0) ||
      a.openedAt.getTime() - b.openedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const steamPageCount = Math.max(1, Math.ceil(selected.length / STEAM_PAGE_SIZE));
  const focusIndex = focus ? selected.findIndex((review) => review.id === focus.id) : -1;
  const requestedPage = Number(url.searchParams.get('steamPage'));
  const steamPage =
    focusIndex >= 0
      ? Math.floor(focusIndex / STEAM_PAGE_SIZE) + 1
      : Number.isSafeInteger(requestedPage)
        ? Math.max(1, Math.min(steamPageCount, requestedPage))
        : 1;
  const offset = (steamPage - 1) * STEAM_PAGE_SIZE;
  const pageIds = selected.slice(offset, offset + STEAM_PAGE_SIZE).map((review) => review.id);
  const positionById = new Map(pageIds.map((id, index) => [id, index]));
  const reviews = await db.steamIntegrityReview.findMany({
    where: { id: { in: pageIds } },
    include: {
      game: {
        select: {
          id: true,
          name: true,
          slug: true,
          platformGameId: true,
          allowSteamBatches: true,
          crossProgress: true,
          totalAchievements: true,
        },
      },
      user: { select: { handle: true, displayName: true } },
      proofs: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, message: true, createdAt: true, imageType: true },
      },
    },
  });
  reviews.sort((a, b) => positionById.get(a.id)! - positionById.get(b.id)!);
  // Les noms des succès signalés, en une jointure : un filtre par jeu et par liste de succès
  // coûtait bien plus cher.
  const wanted = reviews.flatMap((review) =>
    [...new Set(review.flagged.map(steamAchievementId))].map((id) => [review.gameId, id] as const),
  );
  const reviewAchievements = wanted.length
    ? await db.$queryRaw<{ gameId: string; platformAchievementId: string; name: string }[]>`
        SELECT a."gameId", a."platformAchievementId", a.name
        FROM unnest(
          ${wanted.map(([gameId]) => gameId)}::text[], ${wanted.map(([, id]) => id)}::text[]
        ) AS row(game, id)
        JOIN "Achievement" a ON a."gameId" = row.game AND a."platformAchievementId" = row.id`
    : [];
  const names = new Map(
    reviewAchievements.map((achievement) => [
      `${achievement.gameId}:${achievement.platformAchievementId}`,
      achievement.name,
    ]),
  );

  return {
    steamQueue,
    steamPage,
    steamPageCount,
    steamFocus: focusIndex >= 0 && focus ? focus.id : null,
    steamCounts: {
      pending: queues.pending.length,
      proof: queues.proof.length,
      automatic: queues.automatic.length,
      blocked: queues.blocked.length,
    },
    steamReviews: reviews.map((review) => {
      const available = new Set(steamReviewUnlocks(review).map(steamUnlockKey));
      const held = new Set(heldSteamUnlocks(review));
      return {
        id: review.id,
        game: review.game,
        player: review.user,
        openedAt: review.openedAt,
        proofAt: review.proofAt,
        status: review.status,
        suspended: Boolean(review.suspendedAt),
        relatedGames: related.get(review.id) ?? 0,
        heldCount: review.flagged.filter((key) => held.has(key) && available.has(key)).length,
        trust: review.trust as SteamTrust | null,
        proofs: review.proofs.map(({ imageType, ...proof }) => ({
          ...proof,
          image: imageType ? `/moderation/preuves/${proof.id}` : null,
        })),
        unlocks: review.flagged
          .map((key) => {
            const achievementId = steamAchievementId(key);
            return {
              key,
              at: new Date(Number(key.slice(0, key.indexOf(':')))),
              name: names.get(`${review.gameId}:${achievementId}`) ?? achievementId,
              available: available.has(key),
              held: held.has(key),
            };
          })
          .sort((a, b) => a.at.getTime() - b.at.getTime()),
      };
    }),
  };
}

/**
 * Les jeux dont les lots groupés se répètent chez au moins trois joueurs, dont un validé par un
 * modérateur. `EXCEPT` écarte les succès revus sans être retenus : comparer chaque succès à cette
 * liste, qui en compte parfois des centaines, prenait un tiers de seconde.
 */
const loadImportSuggestions = () =>
  db.$queryRaw<
    {
      id: string;
      name: string;
      slug: string;
      players: number;
      approved: number;
      rejected: number;
    }[]
  >`
    SELECT g.id, g.name, g.slug, count(DISTINCT r."steamId")::int AS players,
      (count(*) FILTER (WHERE r.status = 'APPROVED' AND r."reviewedBy" IS NOT NULL))::int AS approved,
      (count(*) FILTER (WHERE r.status = 'REJECTED'))::int AS rejected
    FROM "SteamIntegrityReview" r JOIN "Game" g ON g.id = r."gameId"
    WHERE NOT g."crossProgress" AND NOT g."allowSteamBatches" AND cardinality(r.flagged) >= 8
      AND EXISTS (
        SELECT 1 FROM (
          SELECT unnest(r.flagged) AS unlock_key EXCEPT SELECT unnest(r."reviewOnly")
        ) held
        GROUP BY split_part(unlock_key, ':', 1)
        HAVING count(*) >= 8
      )
    GROUP BY g.id
    HAVING count(DISTINCT r."steamId") >= 3
      AND count(*) FILTER (WHERE r.status = 'APPROVED' AND r."reviewedBy" IS NOT NULL) > 0
    ORDER BY players DESC, g.name LIMIT 20`;

/** Les partenaires de l'API, sans leur secret chiffré. */
const loadPartners = async () =>
  (
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
  }));

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const moderator = requireModerator(locals);
  depends('app:steam-review');
  const admin = moderator.role === 'ADMIN';

  // Rien ici ne dépend du reste : lues l'une après l'autre, ces rubriques faisaient attendre le
  // modérateur à chaque décision.
  const [
    steam,
    importSuggestions,
    crossProgressGames,
    emblems,
    feedback,
    reports,
    signups,
    psnToken,
    partners,
  ] = await Promise.all([
    loadSteamQueue(url),
    loadImportSuggestions(),
    db.game.findMany({
      where: { crossProgress: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    // Les emblèmes sur lesquels l'analyse automatique n'a pas su trancher.
    db.clan.findMany({
      where: { imagePending: true, imageAt: { not: null } },
      orderBy: { imageAt: 'asc' },
      take: 50,
      select: { id: true, name: true, slug: true, imageAt: true },
    }),
    db.feedback.findMany({
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
    }),
    loadReports(),
    // Le suivi des inscriptions : des chiffres sur tout le site, réservés aux administrateurs.
    admin ? signupStats() : undefined,
    // Le jeton du site ne regarde que les administrateurs, qui le renouvellent.
    admin ? psnTokenState() : undefined,
    // Les clés de l'API partenaire aussi : elles ouvrent les données du site à un autre.
    admin ? loadPartners() : undefined,
  ]);

  return {
    ...steam,
    importSuggestions,
    crossProgressGames,
    emblems: emblems.map((clan) => ({
      ...clan,
      url: `/clans/${clan.slug}/image?v=${clan.imageAt!.getTime()}`,
    })),
    signups,
    psnToken,
    partners,
    feedback,
    reports,
  };
};

const feedbackStatus = z.enum(['NEW', 'PLANNED', 'DONE', 'DECLINED']);

function requireAdmin(locals: App.Locals) {
  const user = requireModerator(locals);
  if (user.role !== 'ADMIN') error(404, m.not_found());
  return user;
}

const partnerName = z.string().trim().min(2).max(40);

/** Un nom de domaine public : ni adresse IP, ni nom interne, que le serveur pourrait joindre chez lui. */
function isPublicHost(value: string) {
  if (!URL.canParse(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home)$/.test(host);
}

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
    .refine((value) => value === '' || (/^https:\/\/[^\s]+$/.test(value) && isPublicHost(value))),
});

/** Un NPSSO fait 64 caractères ; la marge couvre un changement de format chez Sony. */
const npsso = z
  .string()
  .trim()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export const actions: Actions = {
  steamReview: async ({ request, locals }) => {
    const moderator = requireModerator(locals);
    const form = await request.formData();
    const id = z.string().min(1).max(100).safeParse(form.get('id'));
    const version = Number(form.get('version'));
    const action = z.enum(['approve', 'selected', 'suspend']).safeParse(form.get('decision'));
    if (!id.success || !Number.isFinite(version) || !action.success) {
      return fail(400, { error: m.action_failed() });
    }
    const accepted = form.getAll('accepted').filter((value) => typeof value === 'string');
    const updated = await resolveSteamReview(
      id.data,
      new Date(version),
      moderator.id,
      accepted,
      action.data,
      form.get('allowBatches') === '1',
    );
    if (!updated) return fail(409, { error: m.steam_review_changed() });
  },
  /** Marque un jeu comme reprenant une progression d'une autre plateforme, ou l'en retire. */
  crossProgress: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const id = z.string().min(1).max(100).safeParse(form.get('id'));
    if (!id.success) return fail(400, { error: m.action_failed() });
    const marked = form.get('value') === '1';
    await db.game.updateMany({
      where: { id: id.data, platform: 'STEAM' },
      data: { crossProgress: marked },
    });
    // Les joueurs suspendus d'office sur ce jeu sont relus tout de suite, sans attendre la tournée.
    if (marked) {
      void recheckBlockedSteam(undefined, 200, id.data).catch((cause: unknown) =>
        log.error('Relecture après progression partagée :', cause),
      );
    }
  },
  /** Remplace le jeton du compte de service PSN, vérifié par Sony avant d'être enregistré. */
  psnToken: async ({ request, locals }) => {
    requireAdmin(locals);
    const parsed = npsso.safeParse((await request.formData()).get('npsso'));
    const rejected = { psn: true, error: m.mod_psn_token_rejected() };
    if (!parsed.success) return fail(400, rejected);
    if (!(await savePsnNpsso(parsed.data))) return fail(400, rejected);
    return { psn: true, success: m.mod_psn_token_saved() };
  },

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
import { unlockHref } from '#lib/activity';
