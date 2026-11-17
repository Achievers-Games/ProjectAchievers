// Tests sur un vrai PostgreSQL : la page de modération des jeux regroupés.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import type { Platform } from '#prisma';
import { db } from './db';
import { PREFIX, setupIntegration } from './test-helpers';
import { actions, load } from '../../routes/moderation/familles/+page.server';
import { GET as searchGames } from '../../routes/moderation/familles/jeux/+server';

setupIntegration();

const moderator = { id: 'mod', role: 'MODERATOR' } as const;

/** Un nom propre à ce test : la recherche isole ses familles du reste de la base. */
const tag = () => `fam${Math.random().toString(36).slice(2, 8)}`;

function game(name: string, platform: Platform, familyKey: string, matched = false) {
  return db.game.create({
    data: {
      platform,
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} ${name}`,
      slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      familyKey,
      familyMatched: matched,
    },
  });
}

type Page = {
  counts: { pending: number; done: number };
  families: { key: string; reason: 'title' | 'list'; games: { id: string }[] }[];
  pages: number;
};

const view = (search: string, vue = '', user: unknown = moderator) =>
  (load as unknown as (e: unknown) => Promise<Page>)({
    url: new URL(`https://achievers.games/moderation/familles?q=${search}&vue=${vue}`),
    locals: { user },
  });

function act(name: keyof typeof actions, fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return (actions[name] as unknown as (e: unknown) => Promise<unknown>)({
    request: new Request(`https://achievers.games/moderation/familles?/${name}`, {
      method: 'POST',
      body,
    }),
    locals: { user: moderator },
  });
}

describe('jeux regroupés', () => {
  it("n'est pas visible d'un simple membre", async () => {
    await expect(view('x', '', { id: 'u', role: 'USER' })).rejects.toMatchObject({ status: 404 });
  });

  it('range une famille validée hors de la file à vérifier', async () => {
    const name = tag();
    const key = `${PREFIX}-${name}`;
    await game(name, 'STEAM', key);
    await game(name, 'PSN', key);

    const before = await view(name);
    expect(before.counts).toEqual({ pending: 1, done: 0 });
    expect(before.families).toHaveLength(1);
    expect(before.families[0]).toMatchObject({ key, reason: 'title' });

    await act('confirm', { family: key });
    expect((await view(name)).counts).toEqual({ pending: 0, done: 1 });
    expect((await view(name, 'validees')).families.map((f) => f.key)).toEqual([key]);
  });

  it('dit quand des jeux sont réunis par leur liste de succès', async () => {
    const name = tag();
    const key = `${PREFIX}-${name}`;
    await game(name, 'STEAM', key, true);
    await game(`${name} autre titre`, 'XBOX', key, true);
    expect((await view(name)).families[0]?.reason).toBe('list');
  });

  it('sépare un jeu, puis le rajoute à sa famille', async () => {
    const name = tag();
    const key = `${PREFIX}-${name}`;
    const steam = await game(name, 'STEAM', key);
    const psn = await game(name, 'PSN', key);

    await act('separate', { id: psn.id });
    expect((await view(name)).families).toHaveLength(0);

    await act('join', { first: steam.id, second: psn.id });
    const joined = await db.game.findMany({ where: { id: { in: [steam.id, psn.id] } } });
    expect(new Set(joined.map((g) => g.familyKey))).toEqual(new Set([key]));
    expect(joined.every((g) => g.familyLocked)).toBe(true);
  });

  it('refuse de regrouper un jeu inconnu ou un jeu avec lui-même', async () => {
    const name = tag();
    const steam = await game(name, 'STEAM', `${PREFIX}-${name}`);
    expect(await act('join', { first: steam.id, second: 'absent' })).toMatchObject({ status: 404 });
    expect(await act('join', { first: steam.id, second: steam.id })).toMatchObject({
      status: 404,
    });
  });

  it('propose les jeux pendant la saisie', async () => {
    const name = tag();
    const steam = await game(name, 'STEAM', `${PREFIX}-${name}`);
    const response = await (searchGames as unknown as (e: unknown) => Promise<Response>)({
      url: new URL(`https://achievers.games/moderation/familles/jeux?q=${name}`),
      locals: { user: moderator },
    });
    expect((await response.json()).map((g: { id: string }) => g.id)).toEqual([steam.id]);
  });
});
