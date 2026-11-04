// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

/** Le module garde les rapports déjà partis : chaque test repart d'une mémoire vide. */
const load = async () => {
  vi.resetModules();
  return import('./report');
};

beforeEach(() => fetchMock.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('rapport d’erreur venu du navigateur', () => {
  it('envoie une erreur une seule fois, en bornant ce qu’elle contient', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const { reportClientError } = await load();
    const error = new Error('x'.repeat(400));

    reportClientError(error, '/jeux');
    reportClientError(error, '/jeux');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/erreur');
    const body = JSON.parse(String(options.body)) as { message: string; context: string };
    expect(body.context).toBe('/jeux');
    expect(body.message).toHaveLength(301);
    expect(body.message.endsWith('…')).toBe(true);
  });

  it('cesse d’envoyer au bout de dix erreurs différentes', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const { reportClientError } = await load();

    for (let index = 0; index < 15; index += 1) reportClientError(`erreur ${index}`, 'boucle');

    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('accepte ce qui n’est pas une erreur et ignore un envoi qui échoue', async () => {
    fetchMock.mockRejectedValueOnce(new Error('réseau'));
    vi.stubGlobal('fetch', fetchMock);
    const { reportClientError } = await load();

    expect(() => reportClientError('texte brut', 'ici')).not.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({ message: 'texte brut' });
  });
});
