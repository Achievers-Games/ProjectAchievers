import { afterEach, describe, expect, it, vi } from 'vitest';
import { clanFrameFor } from '$lib/frames';
import { checkImage, clanImageUrl, imageType } from './clan-image';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');

const answer = (response: string, ok = true) =>
  vi.fn(async () => Response.json({ result: { response } }, { status: ok ? 200 : 400 }));

describe('emblème de clan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reconnaît le format à ses octets, pas à son nom', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageType(WEBP)).toBe('image/webp');
    expect(imageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });

  it('suit le verdict du modèle, et met de côté dans le doute', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'compte');
    vi.stubEnv('CLOUDFLARE_AI_TOKEN', 'jeton');
    const { env } = await import('./env');
    // La configuration est lue une fois : on la relit avec les variables du test.
    Object.assign(env(), { CLOUDFLARE_ACCOUNT_ID: 'compte', CLOUDFLARE_AI_TOKEN: 'jeton' });

    vi.stubGlobal('fetch', answer(' SAFE'));
    expect(await checkImage(PNG)).toBe('safe');
    vi.stubGlobal('fetch', answer('UNSAFE.'));
    expect(await checkImage(PNG)).toBe('unsafe');
    vi.stubGlobal('fetch', answer('I cannot help with that.'));
    expect(await checkImage(PNG)).toBe('unsure');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('réseau');
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkImage(PNG)).toBe('unsure');
  });

  it('ne publie l’adresse qu’une fois l’emblème validé', () => {
    const at = new Date(1_000);
    expect(clanImageUrl({ slug: 'loups', imageAt: at, imagePending: false })).toBe(
      '/clans/loups/image?v=1000',
    );
    expect(clanImageUrl({ slug: 'loups', imageAt: at, imagePending: true })).toBeNull();
    expect(clanImageUrl({ slug: 'loups', imageAt: null, imagePending: false })).toBeNull();
  });

  it('donne un cadre à 5, 15 puis 30 succès de clan', () => {
    expect(clanFrameFor(4)).toBeNull();
    expect(clanFrameFor(5)).toBe('clan-1');
    expect(clanFrameFor(29)).toBe('clan-2');
    expect(clanFrameFor(30)).toBe('clan-3');
  });
});
