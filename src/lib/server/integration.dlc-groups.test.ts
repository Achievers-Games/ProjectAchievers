// Tests sur un vrai PostgreSQL : les succès de DLC séparés du jeu de base.
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setCardsOpeningForTests } from './cards-launch';
import { db } from './db';
import { KNOWN_DLC, withKnownDlc } from './dlc-achievements';
import { env } from './env';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { steamGroupsNow, syncSteamGroups } from './sync/steam';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
const saved = { ...env() };
beforeAll(() => {
  Object.assign(env(), { STEAM_API_KEY: 'cle-de-test' });
  setCardsOpeningForTests(new Date('2026-01-01T00:00:00Z'));
});
afterAll(() => {
  Object.assign(env(), { STEAM_API_KEY: saved.STEAM_API_KEY });
  setCardsOpeningForTests(new Date(0));
});
afterEach(() => vi.unstubAllGlobals());

const start = new Date('2026-06-01T00:00:00Z');
const after = new Date('2026-06-02T00:00:00Z');

/** La page publique d'un jeu Steam, avec ses groupes. */
const pageOf = (appId: string, groups: unknown[]) =>
  new Response(
    `<script id="valve-ssr-data">${JSON.stringify({
      renderContext: {
        queryData: JSON.stringify({
          queries: [
            { queryKey: ['achievements', Number(appId), 'schema_v2'], state: { data: { groups } } },
          ],
        }),
      },
    })}</script>`,
  );

async function game(
  names: string[],
  appId = String(700_000_000 + Math.floor(Math.random() * 1e8)),
) {
  const created = await upsertGame({
    platform: 'STEAM',
    platformGameId: appId,
    name: `${PREFIX} jeu ${appId}`,
  });
  await saveAchievements(
    created.id,
    names.map((name) => ({
      platformAchievementId: name,
      name,
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT' as const,
      globalRarity: 80,
    })),
  );
  await db.game.update({ where: { id: created.id }, data: { tier: 4 } });
  return { id: created.id, platformGameId: appId };
}

const player = () =>
  db.user.create({
    data: {
      handle: `${PREFIX}-${crypto.randomUUID()}`,
      displayName: `${PREFIX} joueur`,
      shardsFrom: start,
    },
  });

const partsOf = async (gameId: string) =>
  Object.fromEntries(
    (
      await db.achievement.findMany({
        where: { gameId },
        orderBy: { platformAchievementId: 'asc' },
        select: { platformAchievementId: true, groupId: true, groupName: true },
      })
    ).map((row) => [row.platformAchievementId, `${row.groupId}|${row.groupName}`]),
  );

describe('DLC connus', () => {
  it('complète Steam sans contredire un groupe déjà publié', () => {
    const [dlc] = KNOWN_DLC['764790']!;
    expect(dlc).toMatchObject({ name: 'Picnic Panic' });
    expect(new Set(dlc!.achievements).size).toBe(8);

    const groups = withKnownDlc(
      '764790',
      new Map([
        ['BEAT_THE_GAME', { groupId: 'default', groupName: '' }],
        ['DEFEAT_OCTO', { groupId: 'default', groupName: '' }],
        ['BUY_TOY', { groupId: 'dlc:9', groupName: 'Publié par Steam' }],
      ]),
    )!;
    expect(groups.get('BEAT_THE_GAME')!.groupId).toBe('default');
    expect(groups.get('DEFEAT_OCTO')).toEqual({
      groupId: 'dlc:1107180',
      groupName: 'Picnic Panic',
    });
    expect(groups.get('BUY_TOY')!.groupId).toBe('dlc:9');
    expect(withKnownDlc('1', undefined)).toBeUndefined();
  });

  it('sépare The Messenger même quand Steam ne répond pas', async () => {
    await db.game.deleteMany({ where: { platform: 'STEAM', platformGameId: '764790' } });
    const messenger = await game(['BEAT_THE_GAME', 'DEFEAT_OCTO'], '764790');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    await steamGroupsNow(messenger);
    expect(await partsOf(messenger.id)).toEqual({
      BEAT_THE_GAME: 'default|',
      DEFEAT_OCTO: 'dlc:1107180|Picnic Panic',
    });
    await db.game.delete({ where: { id: messenger.id } });
  });
});

describe('groupes Steam', () => {
  it('range un jeu, et paie le jeu de base déjà fini, une seule fois', async () => {
    const user = await player();
    const { id, platformGameId } = await game(['A', 'B', 'DLC']);
    const unlocks = ['A', 'B'].map((name) => ({ platformAchievementId: name, unlockedAt: after }));
    await saveProgress(user.id, id, unlocks);
    const shards = async () => (await db.user.findUniqueOrThrow({ where: { id: user.id } })).shards;
    // Deux succès courants, et pas encore de bonus : le DLC manque au 100 %.
    expect(await shards()).toBe(2);

    const groups = [
      { id: 0, name: '', achievements: [{ api_name: 'A' }, { api_name: 'B' }] },
      { id: 1, name: 'Extension', dlcappid: 5, achievements: [{ api_name: 'DLC' }] },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes(`/${platformGameId}/`)
          ? pageOf(platformGameId, groups)
          : pageOf('0', []),
      ),
    );
    await syncSteamGroups(10_000, 0);
    expect(await partsOf(id)).toEqual({ A: 'default|', B: 'default|', DLC: 'dlc:1|Extension' });
    expect(await shards()).toBe(2 + 110);
    const read = await db.game.findUniqueOrThrow({ where: { id } });
    expect(read.achievementGroupsSyncedAt).not.toBeNull();

    // Déjà rangé : ni relu, ni payé deux fois.
    await syncSteamGroups(10_000, 0);
    await saveAchievements(
      id,
      ['A', 'B', 'DLC'].map((name) => ({
        platformAchievementId: name,
        name,
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT' as const,
        groupId: name === 'DLC' ? 'dlc:1' : 'default',
        groupName: name === 'DLC' ? 'Extension' : '',
      })),
    );
    expect(await shards()).toBe(112);
  });

  it('laisse le jeu à ranger quand Steam ne répond pas, et s’arrête après trois échecs', async () => {
    const user = await player();
    const games = [];
    for (let i = 0; i < 4; i++) {
      const created = await game(['A']);
      await saveProgress(user.id, created.id, [{ platformAchievementId: 'A', unlockedAt: after }]);
      games.push(created);
    }
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await syncSteamGroups(10_000, 0);
    expect(
      await db.game.count({
        where: {
          id: { in: games.map(({ id }) => id) },
          achievementGroupsSyncedAt: null,
        },
      }),
    ).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
