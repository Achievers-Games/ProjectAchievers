import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { decrypt, encrypt, pkceChallenge } from './crypto';
import { renderMarkdown } from './markdown';
import { safeReturnTo, saveFlow, takeFlow } from './providers';
import { bioContainsCode } from './providers/psn';
import { steamAuthorizeUrl, verifySteamResponse } from './providers/steam';
import { rateLimit } from './rate-limit';

function fakeCookies(): Cookies {
  const store = new Map<string, string>();
  return {
    get: (name: string) => store.get(name),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
  } as unknown as Cookies;
}

const RETURN_TO = 'http://localhost:5173/auth/steam/callback?state=abc';

function steamQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
    'openid.return_to': RETURN_TO,
    'openid.response_nonce': '2026-10-30T10:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'signature',
    ...overrides,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('chiffrement', () => {
  it('relit ce qui a été chiffré', () => {
    expect(decrypt(encrypt('jeton secret'))).toBe('jeton secret');
  });

  it('refuse un contenu altéré', () => {
    const [iv, tag] = encrypt('jeton').split('.');
    expect(() => decrypt(`${iv}.${tag}.AAAA`)).toThrow();
  });

  it('calcule le challenge PKCE de la RFC 7636', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('flux OAuth', () => {
  const flow = { provider: 'discord' as const, state: 'etat', returnTo: '/compte' };

  it('accepte le bon state une seule fois', () => {
    const cookies = fakeCookies();
    saveFlow(cookies, flow);
    expect(takeFlow(cookies, 'discord', 'etat')).toMatchObject(flow);
    expect(takeFlow(cookies, 'discord', 'etat')).toBeNull();
  });

  it('refuse un state différent ou absent', () => {
    for (const state of ['autre', null]) {
      const cookies = fakeCookies();
      saveFlow(cookies, flow);
      expect(takeFlow(cookies, 'discord', state)).toBeNull();
    }
  });

  it('refuse un flux commencé chez un autre fournisseur', () => {
    const cookies = fakeCookies();
    saveFlow(cookies, flow);
    expect(takeFlow(cookies, 'steam', 'etat')).toBeNull();
  });

  it('refuse les redirections vers un autre site', () => {
    expect(safeReturnTo('/jeux')).toBe('/jeux');
    for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', null]) {
      expect(safeReturnTo(value)).toBe('/compte');
    }
  });
});

describe('OpenID Steam', () => {
  const validResponse = () =>
    vi.fn(async () => new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'));

  it('place le state dans return_to, que Steam signe', () => {
    const url = new URL(steamAuthorizeUrl('mon-etat'));
    expect(url.searchParams.get('openid.return_to')).toContain('state=mon-etat');
  });

  it('accepte une réponse validée par Steam', async () => {
    vi.stubGlobal('fetch', validResponse());
    expect(await verifySteamResponse(steamQuery())).toBe('76561198000000000');
  });

  it('demande la vérification en check_authentication', async () => {
    const fetchMock = validResponse();
    vi.stubGlobal('fetch', fetchMock);
    await verifySteamResponse(steamQuery());
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(String(init.body)).toContain('openid.mode=check_authentication');
  });

  it('refuse une réponse que Steam invalide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('is_valid:false\n')),
    );
    expect(await verifySteamResponse(steamQuery())).toBeNull();
  });

  it.each([
    ['un return_to vers un autre site', { 'openid.return_to': 'https://evil.test/callback' }],
    ['un return_to préfixé', { 'openid.return_to': 'http://localhost:5173/auth/steam/callbackX' }],
    ['un faux point de terminaison', { 'openid.op_endpoint': 'https://evil.test/openid' }],
    [
      'un claimed_id étranger',
      { 'openid.claimed_id': 'https://evil.test/openid/id/76561198000000000' },
    ],
    ['un champ essentiel non signé', { 'openid.signed': 'op_endpoint,identity,return_to' }],
    ['un mode inattendu', { 'openid.mode': 'cancel' }],
  ])('refuse %s sans interroger Steam', async (_label, overrides) => {
    const fetchMock = validResponse();
    vi.stubGlobal('fetch', fetchMock);
    expect(await verifySteamResponse(steamQuery(overrides))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Markdown utilisateur', () => {
  it('retire les scripts et gestionnaires', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/script|onerror|<img/i);
  });

  it('neutralise les liens javascript', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('garde la mise en forme et sécurise les liens', () => {
    const html = renderMarkdown('**gras** [site](https://example.com)');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });
});

describe('vérification PSN', () => {
  it('trouve le code comme mot entier', () => {
    expect(bioContainsCode('Salut ! PA-ABC123 merci', 'PA-ABC123')).toBe(true);
  });

  it('refuse un code incomplet ou inclus dans un autre', () => {
    expect(bioContainsCode('PA-ABC12', 'PA-ABC123')).toBe(false);
    expect(bioContainsCode('XPA-ABC1234', 'PA-ABC123')).toBe(false);
  });
});

describe('limitation de débit', () => {
  it('bloque au-delà de la limite puis repart', () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 2, 1000, 0)).toBe(true);
    expect(rateLimit(key, 2, 1000, 1)).toBe(true);
    expect(rateLimit(key, 2, 1000, 2)).toBe(false);
    expect(rateLimit(key, 2, 1000, 1001)).toBe(true);
  });
});
