// Tests sur un vrai PostgreSQL : les redirections vers un autre site, que SvelteKit 3 refuse sans accord explicite.
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { pkceChallenge, randomToken } from './crypto';
import { db } from './db';
import {
  issueOAuthClient,
  revokeEndpoint,
  revokeGrant,
  tokenEndpoint,
  withPartnerFormAction,
} from './oauth-provider';
import { issuePartnerKey } from './partner-api';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { actions, load } from '../../routes/oauth/authorize/+page.server';
import { GET as START } from '../../routes/auth/[provider]/start/+server';

setupIntegration();
afterAll(() => db.partnerApp.deleteMany({ where: { name: { startsWith: PREFIX } } }));

const REDIRECT = 'https://lure.test/auth/achievers/callback';

async function setup() {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
  const { app } = await issuePartnerKey(`${PREFIX} oauth route ${Math.random()}`);
  await db.partnerApp.update({
    where: { id: app.id },
    data: { webhookUrl: 'https://lure.test/h' },
  });
  const c = await issueOAuthClient(app.id, [REDIRECT]);
  return { user, app, ...c };
}

function query(clientId: string) {
  const verifier = randomToken(32);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'profile',
    state: 'etat',
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return { search: `?${params}`, verifier };
}

/** Ce que la page fait : la redirection lancée, ou les données du formulaire d'accord. */
async function run(fn: () => Promise<unknown>) {
  try {
    return { data: await fn() };
  } catch (thrown) {
    if (thrown && typeof thrown === 'object' && 'location' in thrown) {
      return { location: String((thrown as { location: string }).location) };
    }
    throw thrown;
  }
}

const pageLoad = (userId: string, search: string) =>
  run(() =>
    (load as unknown as (e: unknown) => Promise<unknown>)({
      url: new URL(`https://achievers.games/oauth/authorize${search}`),
      locals: { user: { id: userId } },
    }),
  );

const approve = (userId: string, search: string) => {
  const body = new FormData();
  body.set('query', search);
  return run(() =>
    (actions.approve as unknown as (e: unknown) => Promise<unknown>)({
      request: new Request('https://achievers.games/oauth/authorize?/approve', {
        method: 'POST',
        body,
      }),
      url: new URL('https://achievers.games/oauth/authorize?/approve'),
      locals: { user: { id: userId } },
    }),
  );
};

async function exchange(
  c: { clientId: string; clientSecret: string },
  location: string,
  verifier: string,
) {
  const code = new URL(location).searchParams.get('code')!;
  const response = await tokenEndpoint({
    grant_type: 'authorization_code',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { access_token: string; refresh_token: string };
}

describe('page d’autorisation', () => {
  it('relie de nouveau un joueur qui a déjà autorisé le partenaire', async () => {
    const c = await setup();
    const first = query(c.clientId);
    expect(await pageLoad(c.user.id, first.search)).toHaveProperty('data');
    const approved = await approve(c.user.id, first.search);
    const tokens = await exchange(c, approved.location!, first.verifier);

    // Le partenaire délie de son côté : il révoque ses jetons, l'accord reste.
    await revokeEndpoint({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      token: tokens.access_token,
    });
    await revokeEndpoint({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      token: tokens.refresh_token,
    });
    const second = query(c.clientId);
    const back = await pageLoad(c.user.id, second.search);
    expect(back.location).toContain(REDIRECT);
    await exchange(c, back.location!, second.verifier);

    // Le joueur retire l'accès depuis son compte, puis relie.
    await revokeGrant(c.user.id, c.app.id);
    const third = query(c.clientId);
    expect(await pageLoad(c.user.id, third.search)).toHaveProperty('data');
    const again = await approve(c.user.id, third.search);
    expect(again.location).toContain(REDIRECT);
    await exchange(c, again.location!, third.verifier);
  });
});

describe('connexion par un fournisseur', () => {
  it('envoie vers Steam sans planter', async () => {
    const sent = await run(async () =>
      (START as unknown as (e: unknown) => unknown)({
        params: { provider: 'steam' },
        url: new URL('https://achievers.games/auth/steam/start?retour=/compte'),
        cookies: { set: () => {}, get: () => undefined, delete: () => {} },
      }),
    );
    expect(sent.location).toMatch(/^https:\/\/steamcommunity\.com\/openid\/login/);
  });
});

describe('CSP de la page d’accord', () => {
  it('laisse le formulaire finir chez le partenaire, et seulement à son adresse enregistrée', async () => {
    const c = await setup();
    const csp =
      "default-src 'self'; form-action 'self' https://steamcommunity.com; base-uri 'self'";
    const params = new URLSearchParams(query(c.clientId).search);
    expect(await withPartnerFormAction(csp, params)).toContain(
      "form-action https://lure.test 'self' https://steamcommunity.com;",
    );
    params.set('redirect_uri', 'https://pirate.test/callback');
    expect(await withPartnerFormAction(csp, params)).toBe(csp);
    expect(await withPartnerFormAction(csp, new URLSearchParams())).toBe(csp);
  });
});
