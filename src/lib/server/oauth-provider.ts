import { timingSafeEqual } from 'node:crypto';
import type { Prisma } from '#prisma';
import { json, type RequestEvent } from '@sveltejs/kit';
import { pkceChallenge, randomToken, sha256 } from './crypto';
import { db } from './db';
import { rateLimit } from './rate-limit';
import { queueAccountEvent } from './partner-webhooks';

/**
 * Achievers fournisseur OAuth 2 : « Se connecter avec Achievers » chez un partenaire.
 *
 * Le sous-ensemble sûr et rien d'autre (RFC 6749, 7636, 7009 et les recommandations de la
 * RFC 9700) : code d'autorisation avec PKCE S256 obligatoire, client confidentiel, adresse de
 * retour comparée à l'identique, jetons opaques gardés sous forme d'empreinte, rafraîchissement
 * à usage unique. Pas de flux implicite, pas de mot de passe.
 */

/** Ce qu'un partenaire peut demander. `profile` est toujours accordé avec le reste. */
export const OAUTH_SCOPES = ['profile', 'library', 'achievements'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

const CODE_TTL = 10 * 60_000;
export const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 60 * 24 * 60 * 60_000;
const MINUTE = 60_000;
/** Un partenaire échange ses codes depuis un seul serveur : la limite suit son client. */
const CLIENT_LIMIT = 600;

const PREFIX = { CODE: 'ac_', ACCESS: 'at_', REFRESH: 'rt_' } as const;
type TokenKind = keyof typeof PREFIX;

const hashToken = (token: string) => sha256(token);

/** Compare deux empreintes sans fuite de temps : un secret ne se devine pas caractère par caractère. */
function sameHash(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Les portées demandées, connues et dédoublonnées ; `profile` vient toujours avec. */
export function parseScopes(raw: string | null): OAuthScope[] | null {
  const asked = (raw ?? '').split(/[\s+]+/).filter(Boolean);
  if (asked.some((scope) => !OAUTH_SCOPES.includes(scope as OAuthScope))) return null;
  return OAUTH_SCOPES.filter((scope) => scope === 'profile' || asked.includes(scope));
}

/** Crée ou remplace les identifiants OAuth d'un partenaire : le secret ne s'affiche qu'ici. */
export async function issueOAuthClient(appId: string, redirectUris: string[]) {
  const clientId = `ach_${randomToken(12)}`;
  const clientSecret = `acs_${randomToken(32)}`;
  await db.partnerApp.update({
    where: { id: appId },
    data: {
      oauthClientId: clientId,
      oauthSecretHash: hashToken(clientSecret),
      oauthRedirectUris: redirectUris,
    },
  });
  return { clientId, clientSecret };
}

/** Un nouveau secret client, même identifiant : l'ancien secret cesse aussitôt de valoir. */
export async function rotateOAuthSecret(appId: string) {
  const clientSecret = `acs_${randomToken(32)}`;
  await db.partnerApp.update({
    where: { id: appId },
    data: { oauthSecretHash: hashToken(clientSecret) },
  });
  return clientSecret;
}

/** Une adresse de retour acceptable : HTTPS, sans fragment ; `localhost` pour développer. */
export const isRedirectUri = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

export interface AuthorizeRequest {
  app: { id: string; name: string };
  redirectUri: string;
  scopes: OAuthScope[];
  state: string | null;
  codeChallenge: string;
}

/**
 * Une demande d'autorisation lue et vérifiée. `fatal` : le client ou l'adresse de retour sont
 * douteux, on ne redirige surtout pas vers elle et on affiche l'erreur ici. Sinon, l'erreur
 * repart chez le partenaire, avec son `state`.
 */
export async function readAuthorizeRequest(
  params: URLSearchParams,
): Promise<
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; fatal: true; error: string }
  | { ok: false; fatal: false; redirect: string }
> {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const app = clientId
    ? await db.partnerApp.findUnique({
        where: { oauthClientId: clientId },
        select: { id: true, name: true, revokedAt: true, oauthRedirectUris: true },
      })
    : null;
  if (!app || app.revokedAt) return { ok: false, fatal: true, error: 'unknown_client' };
  if (!app.oauthRedirectUris.includes(redirectUri)) {
    return { ok: false, fatal: true, error: 'invalid_redirect_uri' };
  }

  const state = params.get('state');
  const fail = (error: string) => {
    const back = new URL(redirectUri);
    back.searchParams.set('error', error);
    if (state) back.searchParams.set('state', state);
    return { ok: false as const, fatal: false as const, redirect: back.href };
  };
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type');
  const scopes = parseScopes(params.get('scope'));
  if (!scopes) return fail('invalid_scope');
  const codeChallenge = params.get('code_challenge') ?? '';
  if (params.get('code_challenge_method') !== 'S256' || !/^[\w-]{43,128}$/.test(codeChallenge)) {
    return fail('invalid_request');
  }
  return {
    ok: true,
    request: { app: { id: app.id, name: app.name }, redirectUri, scopes, state, codeChallenge },
  };
}

async function issueToken(
  grantId: string,
  kind: TokenKind,
  scopes: string[],
  ttl: number,
  extra: { codeChallenge?: string; redirectUri?: string } = {},
  now = Date.now(),
  client: Prisma.TransactionClient = db,
) {
  const token = `${PREFIX[kind]}${randomToken(32)}`;
  await client.oAuthToken.create({
    data: {
      grantId,
      kind,
      hash: hashToken(token),
      scopes,
      expiresAt: new Date(now + ttl),
      ...extra,
    },
  });
  return token;
}

/** Le joueur accepte : l'accord retient les portées, et un code à usage unique part chez le partenaire. */
export async function approveAuthorization(userId: string, request: AuthorizeRequest) {
  const before = await db.oAuthGrant.findUnique({
    where: { userId_appId: { userId, appId: request.app.id } },
    select: { revokedAt: true },
  });
  const grant = await db.oAuthGrant.upsert({
    where: { userId_appId: { userId, appId: request.app.id } },
    create: { userId, appId: request.app.id, scopes: request.scopes },
    update: { scopes: request.scopes, revokedAt: null },
    select: { id: true },
  });
  if (!before || before.revokedAt) {
    await queueAccountEvent(userId, 'user.linked', { app: { id: request.app.id }, via: 'OAUTH' });
  }
  const code = await issueToken(grant.id, 'CODE', request.scopes, CODE_TTL, {
    codeChallenge: request.codeChallenge,
    redirectUri: request.redirectUri,
  });
  const back = new URL(request.redirectUri);
  back.searchParams.set('code', code);
  if (request.state) back.searchParams.set('state', request.state);
  return back.href;
}

/** Le joueur refuse : le partenaire l'apprend, sans rien recevoir. */
export function denyAuthorization(request: AuthorizeRequest) {
  const back = new URL(request.redirectUri);
  back.searchParams.set('error', 'access_denied');
  if (request.state) back.searchParams.set('state', request.state);
  return back.href;
}

/** Les erreurs du point de jetons, au format de la RFC 6749 §5.2. */
const tokenError = (error: string, status = 400, description?: string) =>
  json(
    { error, ...(description && { error_description: description }) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

async function authenticateClient(clientId: unknown, clientSecret: unknown) {
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') return null;
  const app = await db.partnerApp.findUnique({
    where: { oauthClientId: clientId },
    select: { id: true, revokedAt: true, oauthSecretHash: true },
  });
  if (!app || app.revokedAt || !app.oauthSecretHash) return null;
  return sameHash(app.oauthSecretHash, hashToken(clientSecret)) ? app : null;
}

/** Un vol se trahit par le réemploi : tout ce que l'accord a délivré cesse aussitôt de valoir. */
const burnGrant = (grantId: string, client: Prisma.TransactionClient = db) =>
  client.oAuthToken.updateMany({
    where: { grantId, usedAt: null },
    data: { usedAt: new Date() },
  });

async function tokenPair(
  grantId: string,
  scopes: string[],
  now: number,
  client: Prisma.TransactionClient,
) {
  const [accessToken, refreshToken] = await Promise.all([
    issueToken(grantId, 'ACCESS', scopes, ACCESS_TTL, {}, now, client),
    issueToken(grantId, 'REFRESH', scopes, REFRESH_TTL, {}, now, client),
  ]);
  return json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL / 1000,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
  );
}

/**
 * `POST /oauth/token`, corps JSON : échange d'un code (`authorization_code`) ou rotation d'un
 * jeton de rafraîchissement (`refresh_token`). Chaque rafraîchissement ne sert qu'une fois.
 */
export async function tokenEndpoint(body: Record<string, unknown>, now = Date.now()) {
  const app = await authenticateClient(body.client_id, body.client_secret);
  if (!app) return tokenError('invalid_client', 401);
  if (!rateLimit(`oauth:${app.id}`, CLIENT_LIMIT, MINUTE, now)) {
    return tokenError('slow_down', 429);
  }

  const raw = body.grant_type === 'authorization_code' ? body.code : body.refresh_token;
  const found =
    typeof raw === 'string'
      ? await db.oAuthToken.findUnique({
          where: { hash: hashToken(raw) },
          select: { grantId: true, grant: { select: { appId: true } } },
        })
      : null;
  if (found && found.grant.appId !== app.id) return tokenError('invalid_grant');
  return db.$transaction(async (tx) => {
    if (found)
      await tx.$queryRaw`SELECT id FROM "OAuthGrant" WHERE id = ${found.grantId} FOR UPDATE`;
    if (body.grant_type === 'authorization_code') {
      if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string') {
        return tokenError('invalid_request');
      }
      const code = await tx.oAuthToken.findUnique({
        where: { hash: hashToken(body.code) },
        include: { grant: { select: { appId: true, revokedAt: true } } },
      });
      if (!code || code.kind !== 'CODE' || code.grant.appId !== app.id) {
        return tokenError('invalid_grant');
      }
      if (code.usedAt) {
        await burnGrant(code.grantId, tx);
        return tokenError('invalid_grant', 400, 'Code already used.');
      }
      // Usage unique, même en cas d'échec ensuite : un code ne se retente pas.
      const { count } = await tx.oAuthToken.updateMany({
        where: { id: code.id, usedAt: null },
        data: { usedAt: new Date(now) },
      });
      if (count === 0) {
        await burnGrant(code.grantId, tx);
        return tokenError('invalid_grant', 400, 'Code already used.');
      }
      if (
        code.expiresAt.getTime() <= now ||
        code.grant.revokedAt ||
        code.redirectUri !== body.redirect_uri ||
        code.codeChallenge !== pkceChallenge(body.code_verifier)
      ) {
        return tokenError('invalid_grant');
      }
      return tokenPair(code.grantId, code.scopes, now, tx);
    }

    if (body.grant_type === 'refresh_token') {
      if (typeof body.refresh_token !== 'string') return tokenError('invalid_request');
      const refresh = await tx.oAuthToken.findUnique({
        where: { hash: hashToken(body.refresh_token) },
        include: { grant: { select: { appId: true, revokedAt: true } } },
      });
      if (!refresh || refresh.kind !== 'REFRESH' || refresh.grant.appId !== app.id) {
        return tokenError('invalid_grant');
      }
      const { count } = await tx.oAuthToken.updateMany({
        where: { id: refresh.id, usedAt: null },
        data: { usedAt: new Date(now) },
      });
      if (count === 0) {
        // Un rafraîchissement déjà employé revient : quelqu'un d'autre le détient.
        await burnGrant(refresh.grantId, tx);
        return tokenError('invalid_grant', 400, 'Refresh token already used.');
      }
      if (refresh.expiresAt.getTime() <= now || refresh.grant.revokedAt) {
        return tokenError('invalid_grant');
      }
      return tokenPair(refresh.grantId, refresh.scopes, now, tx);
    }

    return tokenError('unsupported_grant_type');
  });
}

/**
 * `POST /oauth/revoke` (RFC 7009) : le partenaire retire un jeton. La réponse est toujours 200
 * pour un client valide, que le jeton existe ou non : rien ne s'apprend en essayant.
 */
export async function revokeEndpoint(body: Record<string, unknown>) {
  const app = await authenticateClient(body.client_id, body.client_secret);
  if (!app) return tokenError('invalid_client', 401);
  if (typeof body.token === 'string') {
    const token = await db.oAuthToken.findUnique({
      where: { hash: hashToken(body.token) },
      select: { id: true, kind: true, grantId: true, grant: { select: { appId: true } } },
    });
    if (token && token.grant.appId === app.id) {
      // Retirer un rafraîchissement retire tout l'accord ; un jeton d'accès, seulement lui.
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OAuthGrant" WHERE id = ${token.grantId} FOR UPDATE`;
        if (token.kind === 'REFRESH') await burnGrant(token.grantId, tx);
        else await tx.oAuthToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      });
    }
  }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

/** Le corps JSON d'une requête, ou `null` : `/oauth/token` ne lit que du JSON (voir la doc). */
export async function readJson(event: RequestEvent): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await event.request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const invalidRequest = () => tokenError('invalid_request', 400, 'Body must be JSON.');

/**
 * Le joueur derrière un jeton d'accès, s'il couvre la portée demandée ; sinon la réponse 401
 * ou 403 à renvoyer, avec l'en-tête `WWW-Authenticate` de la RFC 6750.
 */
export async function authenticateBearer(
  event: RequestEvent,
  scope: OAuthScope,
  now = Date.now(),
): Promise<{ userId: string; appId: string } | Response> {
  const header = event.request.headers.get('authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const token = raw.startsWith(PREFIX.ACCESS)
    ? await db.oAuthToken.findUnique({
        where: { hash: hashToken(raw) },
        select: {
          kind: true,
          scopes: true,
          expiresAt: true,
          usedAt: true,
          grant: { select: { userId: true, appId: true, revokedAt: true } },
        },
      })
    : null;
  if (
    !token ||
    token.kind !== 'ACCESS' ||
    token.usedAt ||
    token.grant.revokedAt ||
    token.expiresAt.getTime() <= now
  ) {
    return json(
      { error: 'invalid_token', message: 'Missing, expired or revoked access token.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } },
    );
  }
  if (!token.scopes.includes(scope)) {
    return json(
      { error: 'insufficient_scope', message: `This route needs the ${scope} scope.` },
      {
        status: 403,
        headers: { 'WWW-Authenticate': `Bearer error="insufficient_scope" scope="${scope}"` },
      },
    );
  }
  if (!rateLimit(`oauth-me:${token.grant.appId}`, CLIENT_LIMIT, MINUTE, now)) {
    return json({ error: 'rate_limited', message: 'Too many requests.' }, { status: 429 });
  }
  return { userId: token.grant.userId, appId: token.grant.appId };
}

/** Une route `/me` : le jeton est vérifié avant toute lecture. */
export const meRoute =
  <E extends RequestEvent>(
    scope: OAuthScope,
    handler: (event: E, userId: string) => Promise<Response> | Response,
  ) =>
  async (event: E) => {
    const who = await authenticateBearer(event, scope);
    if (who instanceof Response) return who;
    return handler(event, who.userId);
  };

/** Les applications auxquelles un joueur a donné accès, pour les lui montrer dans `/compte`. */
export const activeGrants = (userId: string) =>
  db.oAuthGrant.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { scopes: true, createdAt: true, app: { select: { id: true, name: true } } },
  });

/** Le joueur retire l'accès : l'accord et tous ses jetons cessent de valoir. */
export async function revokeGrant(userId: string, appId: string) {
  const grant = await db.oAuthGrant.findUnique({
    where: { userId_appId: { userId, appId } },
    select: { id: true },
  });
  if (!grant) return;
  await db.$transaction(async (tx) => {
    await tx.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await burnGrant(grant.id, tx);
  });
  await queueAccountEvent(userId, 'user.unlinked', { app: { id: appId }, via: 'OAUTH' });
}

/**
 * La page d'accord poste un formulaire qui finit chez le partenaire : la CSP `form-action` vaut
 * aussi pour cette redirection, et Chrome la bloquerait. On y ajoute l'origine du retour, seulement
 * quand elle fait partie des adresses que le partenaire a enregistrées.
 */
export async function withPartnerFormAction(csp: string, params: URLSearchParams) {
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  if (!clientId || !redirectUri) return csp;
  const app = await db.partnerApp.findUnique({
    where: { oauthClientId: clientId },
    select: { revokedAt: true, oauthRedirectUris: true },
  });
  if (!app || app.revokedAt || !app.oauthRedirectUris.includes(redirectUri)) return csp;
  const origin = new URL(redirectUri).origin;
  return csp.replace(/(^|;\s*)form-action\s/, `$1form-action ${origin} `);
}
