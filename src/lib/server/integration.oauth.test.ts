// Tests sur un vrai PostgreSQL : Achievers fournisseur OAuth 2 pour les sites partenaires.
import 'dotenv/config';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { pkceChallenge, randomToken } from './crypto';
import { db } from './db';
import {
  approveAuthorization,
  authenticateBearer,
  issueOAuthClient,
  readAuthorizeRequest,
  revokeEndpoint,
  revokeGrant,
  rotateOAuthSecret,
  tokenEndpoint,
  type AuthorizeRequest,
} from './oauth-provider';
import { issuePartnerKey } from './partner-api';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { GET as ME } from '../../routes/api/v1/me/+server';

setupIntegration();
afterAll(() => db.partnerApp.deleteMany({ where: { name: { startsWith: PREFIX } } }));

const REDIRECT = 'https://lure.test/auth/achievers/callback';

async function player(isPublic = true) {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  return db.user.update({ where: { id: result.userId }, data: { isPublic } });
}

async function client() {
  const { app } = await issuePartnerKey(`${PREFIX} oauth ${Math.random()}`);
  const { clientId, clientSecret } = await issueOAuthClient(app.id, [REDIRECT]);
  return { app, clientId, clientSecret };
}

function authorizeParams(clientId: string, overrides: Record<string, string | null> = {}) {
  const verifier = randomToken(32);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'library',
    state: 'etat-123',
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return { params, verifier };
}

async function authorize(userId: string, clientId: string, scope = 'library') {
  const { params, verifier } = authorizeParams(clientId, { scope });
  const read = await readAuthorizeRequest(params);
  if (!read.ok) throw new Error('demande refusée');
  const back = new URL(await approveAuthorization(userId, read.request as AuthorizeRequest));
  return { code: back.searchParams.get('code')!, state: back.searchParams.get('state'), verifier };
}

const bearer = (token: string) =>
  ({
    request: new Request('http://localhost/api/v1/me', {
      headers: { authorization: `Bearer ${token}` },
    }),
    getClientAddress: () => '203.0.113.50',
  }) as unknown as RequestEvent;

async function exchange(
  c: { clientId: string; clientSecret: string },
  code: string,
  verifier: string,
) {
  return tokenEndpoint({
    grant_type: 'authorization_code',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
  });
}

describe('demande d’autorisation', () => {
  it('s’arrête sur place pour un client inconnu ou une adresse de retour étrangère', async () => {
    const { clientId } = await client();
    const unknown = await readAuthorizeRequest(authorizeParams('ach_inconnu').params);
    expect(unknown).toMatchObject({ ok: false, fatal: true });
    const foreign = await readAuthorizeRequest(
      authorizeParams(clientId, { redirect_uri: 'https://pirate.test/cb' }).params,
    );
    expect(foreign).toMatchObject({ ok: false, fatal: true, error: 'invalid_redirect_uri' });
  });

  it('renvoie l’erreur au partenaire sans PKCE S256 ou avec une portée inconnue', async () => {
    const { clientId } = await client();
    const plain = await readAuthorizeRequest(
      authorizeParams(clientId, { code_challenge_method: 'plain' }).params,
    );
    expect(plain.ok).toBe(false);
    if (!plain.ok && !plain.fatal) {
      const back = new URL(plain.redirect);
      expect(back.origin + back.pathname).toBe(REDIRECT);
      expect(back.searchParams.get('error')).toBe('invalid_request');
      expect(back.searchParams.get('state')).toBe('etat-123');
    }
    const scope = await readAuthorizeRequest(
      authorizeParams(clientId, { scope: 'messages' }).params,
    );
    expect(scope).toMatchObject({ ok: false, fatal: false });
  });
});

describe('échange de jetons', () => {
  it('donne un accès au profil, même privé, avec les portées accordées et pas plus', async () => {
    const c = await client();
    const user = await player(false);
    const { code, state, verifier } = await authorize(user.id, c.clientId, 'library');
    expect(state).toBe('etat-123');

    const response = await exchange(c, code, verifier);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const tokens = (await response.json()) as { access_token: string; scope: string };
    expect(tokens.scope).toBe('profile library');

    const me = await ME(bearer(tokens.access_token) as Parameters<typeof ME>[0]);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ handle: user.handle, isPublic: false });

    // La portée achievements n'a pas été demandée : refusée.
    const denied = await authenticateBearer(bearer(tokens.access_token), 'achievements');
    expect((denied as Response).status).toBe(403);
  });

  it('refuse un mauvais vérificateur PKCE, puis le même code une seconde fois', async () => {
    const c = await client();
    const user = await player();
    const { code, verifier } = await authorize(user.id, c.clientId);
    expect((await exchange(c, code, 'mauvais-verificateur-de-quarante-trois-car')).status).toBe(
      400,
    );
    // Le code a servi, même raté : il ne se retente pas.
    expect((await exchange(c, code, verifier)).status).toBe(400);
  });

  it('coupe tout l’accord quand un code déjà échangé revient', async () => {
    const c = await client();
    const user = await player();
    const { code, verifier } = await authorize(user.id, c.clientId);
    const tokens = (await (await exchange(c, code, verifier)).json()) as { access_token: string };
    expect(await authenticateBearer(bearer(tokens.access_token), 'profile')).not.toBeInstanceOf(
      Response,
    );

    expect((await exchange(c, code, verifier)).status).toBe(400);
    expect(
      ((await authenticateBearer(bearer(tokens.access_token), 'profile')) as Response).status,
    ).toBe(401);
  });

  it('refuse un autre client ou un secret faux', async () => {
    const [c, other] = [await client(), await client()];
    const user = await player();
    const { code, verifier } = await authorize(user.id, c.clientId);
    expect((await exchange({ ...c, clientSecret: 'acs_faux' }, code, verifier)).status).toBe(401);
    expect((await exchange(other, code, verifier)).status).toBe(400);
  });

  it('fait tourner le rafraîchissement, et le réemploi d’un ancien coupe l’accord', async () => {
    const c = await client();
    const user = await player();
    const { code, verifier } = await authorize(user.id, c.clientId);
    const first = (await (await exchange(c, code, verifier)).json()) as {
      refresh_token: string;
    };
    const refresh = (token: string) =>
      tokenEndpoint({
        grant_type: 'refresh_token',
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: token,
      });

    const second = await refresh(first.refresh_token);
    expect(second.status).toBe(200);
    const pair = (await second.json()) as { access_token: string; refresh_token: string };

    // Le premier rafraîchissement revient : volé. Tout ce que l'accord a délivré tombe.
    expect((await refresh(first.refresh_token)).status).toBe(400);
    expect(
      ((await authenticateBearer(bearer(pair.access_token), 'profile')) as Response).status,
    ).toBe(401);
    expect((await refresh(pair.refresh_token)).status).toBe(400);
  });

  it('cesse de valoir quand le joueur retire l’accès ou que le partenaire révoque', async () => {
    const c = await client();
    const user = await player();
    const grantTokens = async () => {
      const { code, verifier } = await authorize(user.id, c.clientId);
      return (await (await exchange(c, code, verifier)).json()) as {
        access_token: string;
        refresh_token: string;
      };
    };

    const tokens = await grantTokens();
    await revokeGrant(user.id, c.app.id);
    expect(
      ((await authenticateBearer(bearer(tokens.access_token), 'profile')) as Response).status,
    ).toBe(401);

    // Un nouvel accord du joueur rouvre l'accès ; le partenaire peut le refermer lui-même.
    const again = await grantTokens();
    const revoked = await revokeEndpoint({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      token: again.refresh_token,
    });
    expect(revoked.status).toBe(200);
    expect(
      ((await authenticateBearer(bearer(again.access_token), 'profile')) as Response).status,
    ).toBe(401);
  });

  it('remplace le secret client sans changer d’identifiant', async () => {
    const c = await client();
    const user = await player();
    const fresh = await rotateOAuthSecret(c.app.id);
    const { code, verifier } = await authorize(user.id, c.clientId);
    expect((await exchange(c, code, verifier)).status).toBe(401);
    expect((await exchange({ ...c, clientSecret: fresh }, code, verifier)).status).toBe(200);
  });
});
