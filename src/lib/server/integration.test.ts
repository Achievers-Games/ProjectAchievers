// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  activityFeed,
  cardFeed,
  collectors,
  hasRecentFeat,
  highlights,
  leaderboard,
  listGames,
  seasonStats,
  userCards,
} from './queries';
import { grantFrames } from './frames';
import {
  checkSiteAchievements,
  clanAchievementBoard,
  reviewNewPlayers,
  grantSiteAchievement,
  siteAchievementBoard,
  siteSuggestions,
} from './site-achievements';
import { checkClanAchievements } from './clan-achievements';
import { profileSchema, resolveIdentity, updateProfile, type Identity } from './accounts';
import {
  consolesOf,
  copiesFor,
  difficultyTier,
  nextCopy,
  psnConsole,
  stepOf,
  xboxConsole,
} from '$lib/collection';
import { db } from './db';
import { familyKey, matchFamilies } from './family';
import { groupLibrary } from './library';
import { mergeUsers } from './merge';
import { markActive, subscribersToNotify, usersWhoLeft } from './push';
import { checkLiveGames } from './sync/live';
import { enqueueSync, refreshAccounts, runSync, startWorkers } from './sync/queue';
import { isAdultOnly, rateGames, tagGames } from './sync/content';
import { onCard, onChat, onSync, type SyncEvent } from './sync/events';
import { parseSteamPage, requestStoreSweep, steamImages, sweepSteamStore } from './sync/steam';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { parseGuideFile, syncCuratedGuides } from './curated-guides';
import {
  acceptClanInvite,
  acceptFriend,
  blockUser,
  clanPage,
  createClan,
  flagClanName,
  flagProfaneClans,
  inviteToClan,
  leaveClan,
  markInvitesSeen,
  openDirect,
  pendingInvites,
  readConversation,
  relationWith,
  renameClan,
  reportMessage,
  requestFriend,
  sendMessage,
  unreadCount,
} from './social';
import { splitText, translateContent } from './translate';
import { ensureGameTexts, localizeAchievements } from './achievement-texts';
import { refreshDiscordAccounts } from './sync/discord';
import { UNKNOWN_ICON } from './site-icons';
import { notePsnToken, psnTokenState, warnPsnToken } from './service-token';
import { GENRES, SITE_TOTAL } from '$lib/site-achievements';

const PREFIX = 'zz-test';
const STEAM_ID = '76561190000000001';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  provider: 'STEAM',
  providerUserId: `${PREFIX}-${Math.random()}`,
  displayName: `${PREFIX} joueur`,
  ...overrides,
});

async function cleanup() {
  await db.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await db.game.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(cleanup);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe('rattachement des comptes', () => {
  it('crée un utilisateur pour une identité inconnue', async () => {
    const result = await resolveIdentity(identity(), null);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it('retrouve le même utilisateur à la connexion suivante', async () => {
    const id = identity();
    const first = await resolveIdentity(id, null);
    const second = await resolveIdentity(id, null);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(first.ok && second.ok && first.userId === second.userId).toBe(true);
  });

  it('ne fusionne jamais deux personnes portant le même pseudo', async () => {
    const displayName = `${PREFIX} homonyme`;
    const victim = await resolveIdentity(identity({ displayName }), null);
    const attacker = await resolveIdentity(identity({ displayName }), null);
    expect(victim.ok && attacker.ok && victim.userId !== attacker.userId).toBe(true);
  });

  it('refuse de voler un compte déjà lié à un autre profil', async () => {
    const id = identity();
    await resolveIdentity(id, null);
    const other = await resolveIdentity(identity(), null);
    if (!other.ok) throw new Error('création attendue');
    expect(await resolveIdentity(id, other.userId)).toMatchObject({
      ok: false,
      reason: 'already_linked',
    });
  });

  it('refuse un second compte du même fournisseur', async () => {
    const first = await resolveIdentity(identity(), null);
    if (!first.ok) throw new Error('création attendue');
    expect(await resolveIdentity(identity(), first.userId)).toEqual({
      ok: false,
      reason: 'provider_taken',
    });
  });

  it('chiffre les jetons au repos', async () => {
    const id = identity({ provider: 'DISCORD', accessToken: 'jeton-en-clair' });
    await resolveIdentity(id, null);
    const row = await db.linkedAccount.findUniqueOrThrow({
      where: {
        provider_providerUserId: { provider: 'DISCORD', providerUserId: id.providerUserId },
      },
    });
    expect(row.accessTokenEnc).toBeTruthy();
    expect(row.accessTokenEnc).not.toContain('jeton-en-clair');
  });
});

describe('jeux sur plusieurs plateformes', () => {
  it('reconnaît un même jeu malgré les mentions commerciales', () => {
    expect(familyKey('HEAVY RAIN™')).toBe(familyKey('Heavy Rain'));
    expect(familyKey('Little Nightmares Enhanced Edition')).toBe(familyKey('Little Nightmares'));
    expect(familyKey('The Witcher 3: Wild Hunt — Remastered')).toBe(
      familyKey('The Witcher 3: Wild Hunt'),
    );
    expect(familyKey('Persona 5 Royal')).not.toBe(familyKey('Persona 4 Golden'));
    expect(familyKey('Hotline Miami 2: Wrong Number')).not.toBe(familyKey('Hotline Miami'));
    expect(familyKey('Remastered')).not.toBe('');
  });

  it('réunit deux noms différents quand leurs listes de succès sont identiques', async () => {
    const tag = `${PREFIX}${Math.random().toString(36).slice(2, 8)}`;
    const names = [
      'Premier pas',
      'Deuxième acte',
      'Troisième vague',
      'Quatre saisons',
      'Cinq sur cinq',
    ];
    const list = (extra: string[] = []) =>
      [...names, ...extra].map((name, i) => ({
        platformAchievementId: `${tag}-${i}`,
        name: `${tag} ${name}`,
        description: '',
        hidden: false,
        trophyType: 'BRONZE' as const,
      }));
    const game = (platform: 'STEAM' | 'PSN' | 'XBOX', name: string) =>
      upsertGame({ platform, platformGameId: `${tag}-${platform}`, name });
    const steam = await game('STEAM', `${tag} Saison Deux`);
    const psn = await game('PSN', `${tag} Season 2 Trophies`);
    const xbox = await game('XBOX', `${tag} Saison Deux Bis`);
    await saveAchievements(steam.id, list());
    // Le Platine n'existe que sur PSN : il ne compte pas dans la comparaison.
    await saveAchievements(psn.id, [
      ...list(),
      {
        platformAchievementId: `${tag}-platine`,
        name: `${tag} Platine`,
        description: '',
        hidden: false,
        trophyType: 'PLATINUM',
      },
    ]);
    // Un succès de plus : ce n'est plus le même jeu.
    await saveAchievements(xbox.id, list(['Bonus']));
    // Une réédition sur la même plateforme, avec la même liste, reste le même jeu.
    const remaster = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${tag}-legacy`,
      name: `${tag} Saison Deux Legacy`,
    });
    await saveAchievements(remaster.id, list());

    await matchFamilies();
    const key = async (id: string) =>
      (await db.game.findUniqueOrThrow({ where: { id }, select: { familyKey: true } })).familyKey;
    expect(await key(psn.id)).toBe(await key(steam.id));
    expect(await key(remaster.id)).toBe(await key(steam.id));
    expect(await key(xbox.id)).not.toBe(await key(steam.id));

    // La synchronisation suivante ne défait pas la famille trouvée par les succès.
    await game('PSN', `${tag} Season 2 Trophies`);
    expect(await key(psn.id)).toBe(await key(steam.id));

    // Une liste qui change rend au jeu la famille de son nom.
    await saveAchievements(psn.id, list(['Nouveau DLC']));
    await matchFamilies();
    expect(await key(psn.id)).toBe(familyKey(`${tag} Season 2 Trophies`));
  });

  const row = (platform: 'STEAM' | 'PSN', completion: number, key: string | null = 'jeu') => ({
    unlockedCount: 1,
    completion,
    platinum: false,
    lastUnlockedAt: null,
    game: {
      id: `${platform}-${key}`,
      name: 'Jeu',
      slug: platform.toLowerCase(),
      platform,
      coverUrl: null,
      headerUrl: null,
      totalAchievements: 2,
      familyKey: key,
      tier: null as number | null,
    },
  });

  it('fixe les paliers avant le 100 %', () => {
    expect([0, 24.9, 25, 49, 50, 74, 75, 99, 100].map(stepOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0]);
  });

  it('réunit les versions sur la plus avancée, sans pénaliser une version finie', () => {
    const [card] = groupLibrary([row('PSN', 40), row('STEAM', 100)]);
    expect(card).toMatchObject({ slug: 'steam', tier: 1, copies: 1 });
    expect(card?.progress.completion).toBe(100);
    expect(card?.versions.map((v) => v.platform)).toEqual(['STEAM', 'PSN']);
  });

  it('montre l’exemplaire suivant dès qu’une autre plateforme est commencée', () => {
    expect(nextCopy([{ platform: 'STEAM', completion: 40 }])).toBeNull();
    expect(nextCopy([{ platform: 'STEAM', completion: 100 }])).toBeNull();
    expect(
      nextCopy([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 0 },
      ]),
    ).toBeNull();
    expect(
      nextCopy([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 58 },
      ]),
    ).toEqual({ copies: 2, platform: 'PSN', console: null, completion: 58 });
    expect(
      nextCopy([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 100 },
        { platform: 'XBOX', completion: 12 },
      ]),
    ).toEqual({ copies: 3, platform: 'XBOX', console: null, completion: 12 });
  });

  it('ajoute un exemplaire à chaque plateforme finie, sans changer le niveau', () => {
    const [double] = groupLibrary([row('PSN', 100), row('STEAM', 100)]);
    expect(double).toMatchObject({ tier: 1, copies: 2 });
    expect(groupLibrary([row('PSN', 100), row('STEAM', 100)])).toHaveLength(1);
    expect(groupLibrary([row('PSN', 100, 'a'), row('STEAM', 100, 'b')])).toHaveLength(2);
    expect(copiesFor(5)).toBe(4);
  });

  it('compte chaque console PlayStation comme un exemplaire à part', () => {
    expect(['PS4', 'PS5,PS4', 'PSVITA', 'PS4,PSVITA', 'PSPC', '', null].map(psnConsole)).toEqual([
      'PS4',
      'PS4/PS5',
      'Vita',
      'PS4/Vita',
      null,
      null,
      null,
    ]);
    const on = (console: string, completion: number) => {
      const version = row('PSN', completion);
      return { ...version, game: { ...version.game, id: console, console } };
    };
    const [card] = groupLibrary([on('PS3', 100), on('PS4', 100), row('STEAM', 100)]);
    expect(card?.copies).toBe(3);
    expect(card?.versions.map((v) => v.console)).toEqual(['PS3', 'PS4', null]);
    expect(
      nextCopy([
        { platform: 'PSN', console: 'PS3', completion: 100 },
        { platform: 'PSN', console: 'PS4', completion: 30 },
      ]),
    ).toEqual({ copies: 2, platform: 'PSN', console: 'PS4', completion: 30 });
  });

  it('sépare Xbox 360 des listes One, Series et PC qu’elles partagent', () => {
    expect(
      [
        ['Xbox360'],
        ['XboxOne', 'XboxSeries', 'PC'],
        ['XboxSeries', 'PC'],
        ['PC'],
        ['Mobile'],
        [],
      ].map(xboxConsole),
    ).toEqual(['Xbox 360', 'Xbox One/Series', 'Xbox Series', 'PC', null, null]);
    expect(consolesOf('Xbox One/Series')).toEqual(['One', 'Series']);
    expect(consolesOf('PS4/PS5')).toEqual(['PS4', 'PS5']);
  });

  it('garde le niveau de la version finie la plus dure', () => {
    const version = (platform: 'STEAM' | 'PSN', completion: number, tier: number) => {
      const version = row(platform, completion);
      version.game.tier = tier;
      return version;
    };
    expect(groupLibrary([version('PSN', 100, 5), version('STEAM', 100, 2)])[0]?.tier).toBe(5);
    expect(groupLibrary([version('STEAM', 100, 2), version('PSN', 50, 6)])[0]?.tier).toBe(2);
  });

  it('classe un jeu selon son succès le plus rare, sinon selon sa taille', () => {
    expect([40, 10, 5, 2, 1.5, 0.5, 0.2].map((rarity) => difficultyTier(rarity, 30))).toEqual([
      1, 1, 2, 3, 4, 5, 6,
    ]);
    expect([10, 30, 50, 100, 200, 8000].map((size) => difficultyTier(null, size))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('modification du profil', () => {
  const handle = () => `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`;

  async function profile(overrides: Partial<Identity> = {}) {
    const created = await resolveIdentity(identity(overrides), null);
    if (!created.ok) throw new Error('création attendue');
    return created.userId;
  }

  it('garde le nom choisi après une reconnexion', async () => {
    const id = identity({ displayName: `${PREFIX} Prénom Nom`, avatarUrl: 'https://a.test/1.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('création attendue');

    const newHandle = handle();
    expect(
      await updateProfile(created.userId, {
        displayName: 'Pseudo',
        handle: newHandle,
        avatarUrl: 'https://a.test/1.png',
      }),
    ).toBeNull();
    await resolveIdentity(id, null);

    expect(await db.user.findUniqueOrThrow({ where: { id: created.userId } })).toMatchObject({
      displayName: 'Pseudo',
      handle: newHandle,
    });
  });

  it('refuse un identifiant déjà pris', async () => {
    const first = await profile();
    const second = await profile();
    const { handle: taken } = await db.user.findUniqueOrThrow({ where: { id: first } });
    expect(
      await updateProfile(second, { displayName: 'Pseudo', handle: taken, avatarUrl: '' }),
    ).toBe('handle_taken');
  });

  it("refuse une image qui ne vient pas d'un compte lié", async () => {
    const userId = await profile({ avatarUrl: 'https://a.test/1.png' });
    await profile({ avatarUrl: 'https://a.test/autre.png' });
    expect(
      await updateProfile(userId, {
        displayName: 'Pseudo',
        handle: handle(),
        avatarUrl: 'https://a.test/autre.png',
      }),
    ).toBe('avatar_unknown');
  });

  it('valide le nom et le format de l’identifiant', () => {
    const valid = { displayName: '  Pseudo ', handle: 'Mon-Pseudo', avatarUrl: '' };
    expect(profileSchema.parse(valid)).toMatchObject({
      displayName: 'Pseudo',
      handle: 'mon-pseudo',
    });
    for (const bad of ['a', 'ab_cd', '-abc', 'abc-', 'a'.repeat(25), 'é-abc', '../admin']) {
      expect(profileSchema.safeParse({ ...valid, handle: bad }).success).toBe(false);
    }
    for (const bad of ['x', 'y'.repeat(33), 'nom‮inversé', 'a\nb']) {
      expect(profileSchema.safeParse({ ...valid, displayName: bad }).success).toBe(false);
    }
  });
});

describe('calcul de la progression', () => {
  async function fixture(trophyTypes: ('PLATINUM' | 'GOLD' | 'ACHIEVEMENT')[]) {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('création attendue');
    const game = await upsertGame({
      platform: 'PSN',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(
      game.id,
      trophyTypes.map((trophyType, i) => ({
        platformAchievementId: String(i),
        name: `T${i}`,
        description: '',
        hidden: false,
        trophyType,
      })),
    );
    return { userId: created.userId, gameId: game.id };
  }

  it('calcule la complétion et reste idempotent', async () => {
    const { userId, gameId } = await fixture(['GOLD', 'GOLD']);
    const unlock = [{ platformAchievementId: '0', unlockedAt: new Date() }];
    expect(await saveProgress(userId, gameId, unlock)).toBe(1);
    expect(await saveProgress(userId, gameId, unlock)).toBe(0);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row).toMatchObject({ unlockedCount: 1, totalCount: 2, completion: 50, platinum: false });
  });

  it('exige le trophée platine sur PSN', async () => {
    const { userId, gameId } = await fixture(['PLATINUM', 'GOLD']);
    await saveProgress(userId, gameId, [{ platformAchievementId: '1', unlockedAt: new Date() }]);
    await saveProgress(userId, gameId, [{ platformAchievementId: '0', unlockedAt: new Date() }]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row.platinum).toBe(true);
  });

  it('réserve la platine au trophée, pas au 100 %', async () => {
    const { userId, gameId } = await fixture(['ACHIEVEMENT']);
    await saveProgress(userId, gameId, [{ platformAchievementId: '0', unlockedAt: new Date() }]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row).toMatchObject({ completion: 100, platinum: false });
  });

  it('ignore un déverrouillage inconnu du catalogue', async () => {
    const { userId, gameId } = await fixture(['GOLD']);
    expect(
      await saveProgress(userId, gameId, [{ platformAchievementId: '99', unlockedAt: new Date() }]),
    ).toBe(0);
  });
});

describe('fusion de profils', () => {
  async function twoProfiles() {
    const steam = identity();
    const discord = identity({ provider: 'DISCORD' });
    const source = await resolveIdentity(steam, null);
    const target = await resolveIdentity(discord, null);
    if (!source.ok || !target.ok) throw new Error('création attendue');
    return {
      sourceId: source.userId,
      targetId: target.userId,
      merge: {
        sourceId: source.userId,
        targetId: target.userId,
        provider: steam.provider,
        providerUserId: steam.providerUserId,
      },
      steam,
    };
  }

  it('garde les succès du site des deux profils', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await db.siteUnlock.createMany({
      data: [
        { userId: sourceId, code: 'deserter' },
        { userId: sourceId, code: 'stage_name' },
        { userId: targetId, code: 'deserter' },
      ],
    });
    expect(await mergeUsers(merge)).toBeNull();
    const rows = await db.siteUnlock.findMany({ where: { userId: targetId } });
    expect(rows.map((row) => row.code).toSorted()).toEqual(['deserter', 'stage_name']);
  });

  async function guideFor(authorId: string) {
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(game.id, [
      {
        platformAchievementId: '0',
        name: 'T',
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT',
      },
    ]);
    const achievement = await db.achievement.findFirstOrThrow({ where: { gameId: game.id } });
    const guide = await db.guide.create({
      data: { achievementId: achievement.id, authorId, contentMd: 'x' },
    });
    return { game, achievement, guide };
  }

  it('réunit comptes, progression et contenus puis supprime le profil absorbé', async () => {
    const { sourceId, targetId, merge, steam } = await twoProfiles();
    const { game, guide } = await guideFor(sourceId);
    await db.userGame.create({ data: { userId: sourceId, gameId: game.id } });

    expect(await mergeUsers(merge)).toBeNull();

    expect(await db.user.findUnique({ where: { id: sourceId } })).toBeNull();
    expect(await db.linkedAccount.count({ where: { userId: targetId } })).toBe(2);
    expect(await db.userGame.count({ where: { userId: targetId } })).toBe(1);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).authorId).toBe(targetId);

    const login = await resolveIdentity(steam, null);
    expect(login).toMatchObject({ ok: true, userId: targetId, created: false });
  });

  it('garde un seul vote par guide et recalcule le score', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    const { guide } = await guideFor(sourceId);
    await db.guideVote.createMany({
      data: [
        { guideId: guide.id, userId: sourceId, value: 1 },
        { guideId: guide.id, userId: targetId, value: -1 },
      ],
    });
    await db.guide.update({ where: { id: guide.id }, data: { score: 0 } });

    expect(await mergeUsers(merge)).toBeNull();

    expect(await db.guideVote.findMany({ where: { guideId: guide.id } })).toMatchObject([
      { userId: targetId, value: -1 },
    ]);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).score).toBe(-1);
  });

  it('conserve le rôle le plus élevé et le choix de profil privé', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await db.user.update({
      where: { id: sourceId },
      data: { role: 'MODERATOR', isPublic: false },
    });

    await mergeUsers(merge);

    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({
      role: 'MODERATOR',
      isPublic: false,
    });
  });

  it('refuse deux comptes du même fournisseur et ne change rien', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await resolveIdentity(identity({ provider: 'STEAM' }), targetId);

    expect(await mergeUsers(merge)).toBe('provider_conflict');
    expect(await db.user.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('refuse si le compte a changé de profil depuis la demande', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    expect(await mergeUsers({ ...merge, providerUserId: 'autre' })).toBe('stale');
    expect(await mergeUsers({ ...merge, sourceId: targetId })).toBe('stale');
    expect(await db.user.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('attend la fin des synchronisations', async () => {
    const { sourceId, merge } = await twoProfiles();
    await db.linkedAccount.updateMany({
      where: { userId: sourceId },
      data: { syncStatus: 'SYNCING' },
    });
    expect(await mergeUsers(merge)).toBe('sync_running');
  });
});

function steamApi(owned: unknown) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const body = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes('GetOwnedGames')) return body(owned);
    if (url.includes('GetRecentlyPlayedGames') || url.includes('GetTopAchievementsForGames')) {
      return body({ response: { games: [] } });
    }
    if (url.includes('GetFriendList')) return body({ friendslist: { friends: [] } });
    if (url.includes('GetSchemaForGame')) {
      return body({
        game: {
          availableGameStats: {
            achievements: [
              { name: 'A', displayName: 'Alpha', hidden: 0, icon: 'i', icongray: 'g' },
              { name: 'B', displayName: 'Bêta', hidden: 0, icon: 'i', icongray: 'g' },
            ],
          },
        },
      });
    }
    if (url.includes('GetGlobalAchievementPercentages')) {
      return body({
        achievementpercentages: { achievements: [{ name: 'A', percent: '42.5' }] },
      });
    }
    if (url.includes('GetPlayerAchievements')) {
      return body({
        playerstats: {
          achievements: [
            { apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 },
            { apiname: 'B', achieved: 0, unlocktime: 0 },
          ],
        },
      });
    }
    throw new Error(`Appel inattendu : ${url}`);
  });
}

const ownedGames = {
  response: {
    games: [
      {
        appid: 999001,
        name: `${PREFIX} steam`,
        playtime_forever: 90,
        rtime_last_played: 1_700_000_100,
        has_community_visible_stats: true,
      },
    ],
  },
};

async function steamUser() {
  const id = identity({ providerUserId: STEAM_ID + Math.floor(Math.random() * 1e6) });
  const created = await resolveIdentity(id, null);
  if (!created.ok) throw new Error('création attendue');
  return created.userId;
}

describe('synchronisation Steam', () => {
  it('importe jeux, succès et rareté', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('COMPLETED');
    const progress = await db.userGame.findFirstOrThrow({
      where: { userId },
      include: { game: { include: { achievements: true } } },
    });
    expect(progress).toMatchObject({ unlockedCount: 1, totalCount: 2, completion: 50 });
    expect(progress.game.achievements.find((a) => a.name === 'Alpha')?.globalRarity).toBe(42.5);
  });

  it("ne relit pas un jeu qui n'a pas été relancé", async () => {
    const fetchMock = steamApi(ownedGames);
    vi.stubGlobal('fetch', fetchMock);
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });
    fetchMock.mockClear();
    await runSync({ userId, provider: 'STEAM' });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes('GetPlayerAchievements'))).toBe(false);
  });

  /** Un ami possède le jeu 999003 ; le joueur y a des succès sans l'avoir en bibliothèque. */
  function sharedGameApi(calls: string[] = []) {
    const api = steamApi(ownedGames);
    const body = (value: unknown) => new Response(JSON.stringify(value));
    const friend = '76561190000000002';
    const borrowed = { appid: 999003, name: `${PREFIX} emprunté` };
    return vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('GetFriendList')) {
        return body({ friendslist: { friends: [{ steamid: friend }] } });
      }
      if (url.includes('GetOwnedGames') && url.includes(friend)) {
        return body({ response: { games: [borrowed] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        const asked = url.includes('999003');
        return body({
          response: {
            games: asked ? [{ appid: 999003, achievements: [{ name: 'Alpha' }] }] : [],
          },
        });
      }
      if (url.includes('GetAppList')) {
        return body({ response: { apps: [{ appid: 999003, name: borrowed.name }] } });
      }
      return api(input);
    });
  }

  it('retrouve un jeu partagé en famille grâce à la bibliothèque d’un ami', async () => {
    vi.stubGlobal('fetch', sharedGameApi());
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const row = await db.userGame.findFirstOrThrow({
      where: { userId, game: { platformGameId: '999003' } },
    });
    expect(row).toMatchObject({ unlockedCount: 1, completion: 50, lastPlayedAt: null });
  });

  it('ne cherche les jeux partagés chez les amis qu’une fois par jour', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', sharedGameApi(calls));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });
    calls.length = 0;
    await runSync({ userId, provider: 'STEAM' });

    expect(calls.some((url) => url.includes('GetFriendList'))).toBe(false);
  });

  it('garde la synchronisation si la recherche des jeux partagés échoue', async () => {
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetTopAchievementsForGames')
        ? new Response('', { status: 403 })
        : api(input),
    );
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('COMPLETED');
    expect(account.sharedCheckedAt).toBeNull();
  });

  it('balaye la boutique pour un compte, puis le laisse tranquille', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', sharedGameApi(calls));
    await db.linkedAccount.updateMany({
      where: { provider: 'STEAM' },
      data: { storeSweptAt: new Date() },
    });
    const userId = await steamUser();

    expect(await sweepSteamStore()).toBe(1);
    expect(await db.userGame.count({ where: { userId } })).toBe(1);

    calls.length = 0;
    expect(await sweepSteamStore()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('avance le balayage à la demande du joueur, au plus une fois par semaine', async () => {
    const userId = await steamUser();
    const sweptAt = async () =>
      (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).storeSweptAt;
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db.linkedAccount.updateMany({ where: { userId }, data: { storeSweptAt: recent } });

    await requestStoreSweep(userId);
    expect(await sweptAt()).toEqual(recent);

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.linkedAccount.updateMany({ where: { userId }, data: { storeSweptAt: old } });
    await requestStoreSweep(userId);
    expect(await sweptAt()).toBeNull();
  });

  it('demande à la boutique l’image des jeux récents', async () => {
    const image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/abc.jpg';
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('appdetails')
        ? new Response(JSON.stringify({ 42: { data: { header_image: image } } }))
        : new Response(null, { status: 404 }),
    );
    expect(await steamImages(42)).toEqual({ coverUrl: image, headerUrl: image });

    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }));
    expect((await steamImages(42)).headerUrl).toContain('/42/header.jpg');
  });

  it('fait arriver en direct un succès du jeu lancé', async () => {
    const unlocked = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    let steamid = '';
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) => {
      if (String(input).includes('GetPlayerSummaries')) {
        return new Response(
          JSON.stringify({ response: { players: [{ steamid, gameid: '999001' }] } }),
        );
      }
      return String(input).includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    steamid = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await checkLiveGames();
    await checkLiveGames();
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'COMPLETED', achievements: 1, quiet: true });
  });

  it('annonce une carte quand un jeu atteint 100 %, une seule fois', async () => {
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetPlayerAchievements')
        ? new Response(
            JSON.stringify({
              playerstats: {
                achievements: [
                  { apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 },
                  { apiname: 'B', achieved: 1, unlocktime: 1_700_000_000 },
                ],
              },
            }),
          )
        : api(input),
    );
    const userId = await steamUser();
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    await runSync({ userId, provider: 'STEAM' });
    expect(events.at(-1)?.rewards).toMatchObject([
      { game: { name: `${PREFIX} steam` }, progress: { completion: 100, platinum: false } },
    ]);

    await runSync({ userId, provider: 'STEAM' });
    stop();
    expect(events.at(-1)?.rewards).toEqual([]);
  });

  it('diffuse en direct un 100 % récent, pas un ancien ni celui d’un profil privé', async () => {
    const unlockAt = (date: number) => {
      const api = steamApi(ownedGames);
      vi.stubGlobal('fetch', async (input: string | URL) =>
        String(input).includes('GetPlayerAchievements')
          ? new Response(
              JSON.stringify({
                playerstats: {
                  achievements: ['A', 'B'].map((apiname) => ({
                    apiname,
                    achieved: 1,
                    unlocktime: Math.floor(date / 1000),
                  })),
                },
              }),
            )
          : api(input),
      );
    };
    const cards: string[] = [];
    const stop = onCard((drop) => cards.push(drop.user.handle));

    unlockAt(Date.now() - 365 * 86_400_000);
    await runSync({ userId: await steamUser(), provider: 'STEAM' });
    expect(cards).toEqual([]);

    unlockAt(Date.now());
    const privateUser = await steamUser();
    await db.user.update({ where: { id: privateUser }, data: { isPublic: false } });
    await runSync({ userId: privateUser, provider: 'STEAM' });
    expect(cards).toEqual([]);

    const userId = await steamUser();
    await db.game.updateMany({
      where: { players: { some: { userId: privateUser } } },
      data: { contentCheckedAt: null },
    });
    await runSync({ userId, provider: 'STEAM' });
    expect(cards).toEqual([]);

    const rated = await steamUser();
    await db.game.updateMany({
      where: { players: { some: { userId: privateUser } } },
      data: { contentCheckedAt: new Date() },
    });
    await runSync({ userId: rated, provider: 'STEAM' });
    stop();
    const { handle } = await db.user.findUniqueOrThrow({ where: { id: rated } });
    expect(cards).toEqual([handle]);
  });

  it('ne masque que la nudité fréquente et le contenu réservé aux adultes', async () => {
    expect(isAdultOnly([1, 2, 5])).toBe(false);
    expect(isAdultOnly([])).toBe(false);
    expect(isAdultOnly([1, 3, 4, 5])).toBe(true);
    expect(isAdultOnly([4])).toBe(true);
    expect(isAdultOnly([3])).toBe(true);
  });

  it('classe les jeux Steam et les masque tant que le joueur ne les demande pas', async () => {
    const name = `${PREFIX} classement`;
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name,
    });
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            [game.platformGameId]: { data: { content_descriptors: { ids: [1, 3, 4, 5] } } },
          }),
        ),
    );
    await db.game.updateMany({
      where: { contentCheckedAt: null, NOT: { id: game.id } },
      data: { contentCheckedAt: new Date() },
    });

    expect(await rateGames(10, 0)).toBe(1);

    const filters = { q: name, sort: 'nom', page: 1 } as const;
    expect((await listGames(filters, null)).games).toEqual([]);
    expect((await listGames({ ...filters, showAdult: true }, null)).games).toHaveLength(1);
    expect(await rateGames(10, 0)).toBe(0);
  });

  it('lit les genres des jeux Steam, et les prête aux autres plateformes', async () => {
    const appId = String(900_000_000 + Math.floor(Math.random() * 1_000_000));
    const steam = await upsertGame({
      platform: 'STEAM',
      platformGameId: appId,
      name: `${PREFIX} Peur`,
    });
    const sibling = await upsertGame({
      platform: 'PSN',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} Peur`,
    });
    const found = await upsertGame({
      platform: 'XBOX',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} Mignon`,
    });
    const lost = await upsertGame({
      platform: 'XBOX',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} Introuvable`,
    });
    const cuteId = appId + '1';
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('storesearch')) {
        const hit = url.includes('Mignon')
          ? [{ id: Number(cuteId), name: `${PREFIX} Mignon™` }]
          : [];
        return new Response(JSON.stringify({ items: hit }));
      }
      const items = [
        {
          appid: Number(appId),
          tags: [
            { tagid: 492, weight: 50 },
            { tagid: 1667, weight: 900 },
          ],
        },
        { appid: Number(cuteId), tags: [{ tagid: 4726, weight: 300 }] },
      ];
      return new Response(JSON.stringify({ response: { store_items: items } }));
    });
    await db.game.updateMany({
      where: { tagsCheckedAt: null, id: { notIn: [steam.id, sibling.id, found.id, lost.id] } },
      data: { tagsCheckedAt: new Date() },
    });

    expect(await tagGames(10, 0)).toBe(4);

    const tags = async (id: string) =>
      (await db.game.findUniqueOrThrow({ where: { id }, select: { tags: true } })).tags;
    expect(await tags(steam.id)).toEqual([1667, 492]);
    expect(await tags(sibling.id)).toEqual([1667, 492]);
    expect(await tags(found.id)).toEqual([4726]);
    expect(await tags(lost.id)).toEqual([]);
    expect(await tagGames(10, 0)).toBe(0);
  });

  it('accepte un texte hors de l’alphabet latin', async () => {
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} ゲーム 🎮`,
    });
    await saveAchievements(game.id, [
      {
        platformAchievementId: '0',
        name: 'Достижение �',
        description: '成就',
        hidden: false,
        trophyType: 'ACHIEVEMENT',
      },
    ]);
    const saved = await db.achievement.findFirstOrThrow({ where: { gameId: game.id } });
    expect(saved.name).toBe('Достижение �');
  });

  it('continue quand un seul jeu est illisible', async () => {
    const appid = 999002;
    const api = steamApi({
      response: {
        games: [
          ...ownedGames.response.games,
          { ...ownedGames.response.games[0], appid, name: `${PREFIX} cassé` },
        ],
      },
    });
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetSchemaForGame') && String(input).includes(`appid=${appid}`)
        ? new Response('pas du json')
        : api(input),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('COMPLETED');
    expect(await db.userGame.count({ where: { userId } })).toBe(1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('n’émet plus de progression après un échec', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetOwnedGames')
        ? new Response(
            JSON.stringify({
              response: {
                games: Array.from({ length: 12 }, (_, i) => ({
                  ...ownedGames.response.games[0],
                  appid: 999100 + i,
                })),
              },
            }),
          )
        : new Response(null, { status: 403 }),
    );
    const userId = await steamUser();
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    await runSync({ userId, provider: 'STEAM' });
    stop();

    expect(events.at(-1)?.status).toBe('FAILED');
    expect(events.filter((e) => e.processed > 0)).toEqual([]);
  });

  it('explique clairement un profil privé', async () => {
    vi.stubGlobal('fetch', steamApi({ response: {} }));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('FAILED');
    expect(account.syncError).toBe('sync_steam_private');
  });

  it('passe par la file de tâches et publie la progression', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    await startWorkers();
    const userId = await steamUser();

    const events: SyncEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      const stop = onSync(userId, (event) => {
        events.push(event);
        if (event.status === 'COMPLETED' || event.status === 'FAILED') {
          stop();
          resolve();
        }
      });
    });

    expect(await enqueueSync(userId, 'STEAM')).toBe(true);
    expect(await enqueueSync(userId, 'STEAM')).toBe(false);
    await finished;

    expect(events.map((e) => e.status)).toEqual(
      expect.arrayContaining(['QUEUED', 'SYNCING', 'COMPLETED']),
    );
  });
});

describe('traduction des guides et commentaires', () => {
  const answer = (content: string, finish_reason = 'stop') =>
    new Response(
      JSON.stringify({ result: { choices: [{ finish_reason, message: { content } }] } }),
    );

  async function guide() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} traduction`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const achievement = await db.achievement.create({
      data: { gameId: game.id, platformAchievementId: 'a', name: 'Succès' },
    });
    return db.guide.create({
      data: {
        achievementId: achievement.id,
        authorId: result.userId,
        contentMd: 'Reste derrière.',
      },
    });
  }

  it('ne demande la traduction qu’une fois par langue', async () => {
    const { id } = await guide();
    const fetchMock = vi.fn(async () => answer('Stay behind.'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await translateContent({ guideId: id }, 'Reste derrière.', 'en')).toBe('Stay behind.');
    expect(await translateContent({ guideId: id }, 'Reste derrière.', 'en')).toBe('Stay behind.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne garde pas une traduction coupée', async () => {
    const { id } = await guide();
    vi.stubGlobal('fetch', async () => answer('Stay', 'length'));

    await expect(translateContent({ guideId: id }, 'Reste derrière.', 'de')).rejects.toThrow();
    expect(await db.contentTranslation.count({ where: { guideId: id } })).toBe(0);
  });

  it('découpe un long texte aux paragraphes', () => {
    expect(splitText('aaaa\n\nbbbb\n\ncc', 10)).toEqual(['aaaa\n\nbbbb', 'cc']);
    expect(splitText('un seul bloc', 5)).toEqual(['un', 'seul', 'bloc']);
  });
});

describe('avatars animés', () => {
  it('suit l’animation du compte dont le profil utilise l’image', async () => {
    const id = identity({
      avatarUrl: 'https://a.test/fixe.png',
      avatarMotionUrl: 'https://a.test/anime.gif',
    });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    const read = () =>
      db.user.findUniqueOrThrow({
        where: { id: created.userId },
        select: { avatarMotionUrl: true },
      });
    expect(await read()).toEqual({ avatarMotionUrl: 'https://a.test/anime.gif' });

    await resolveIdentity({ ...id, avatarMotionUrl: null }, null);
    expect(await read()).toEqual({ avatarMotionUrl: null });

    await resolveIdentity(id, null);
    expect(await read()).toEqual({ avatarMotionUrl: 'https://a.test/anime.gif' });

    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    await updateProfile(created.userId, {
      displayName: 'Pseudo',
      handle: user.handle,
      avatarUrl: '',
    });
    expect(await read()).toEqual({ avatarMotionUrl: null });
  });
});

describe('cadres importés', () => {
  it('suit le cadre de la plateforme, et le retire avec elle', async () => {
    const id = identity({ frameUrl: 'https://a.test/cadre.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    const where = { id: created.userId };
    await db.user.update({ where, data: { frame: 'https://a.test/cadre.png' } });

    await resolveIdentity({ ...id, frameUrl: 'https://a.test/autre.png' }, null);
    expect((await db.user.findUniqueOrThrow({ where })).frame).toBe('https://a.test/autre.png');

    await resolveIdentity({ ...id, frameUrl: null }, null);
    expect((await db.user.findUniqueOrThrow({ where })).frame).toBeNull();
  });

  it('suit le nouvel avatar d’un compte déjà choisi', async () => {
    const id = identity({ avatarUrl: 'https://a.test/ancien.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');

    await resolveIdentity({ ...id, avatarUrl: 'https://a.test/nouveau.png' }, null);
    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.avatarUrl).toBe('https://a.test/nouveau.png');
  });

  it('suit Discord sans jeton de joueur', async () => {
    const stale = await db.linkedAccount.findMany({ where: { provider: 'DISCORD' } });
    await db.linkedAccount.updateMany({
      where: { provider: 'DISCORD' },
      data: { lastSyncedAt: new Date() },
    });
    const id = identity({
      provider: 'DISCORD',
      providerUserId: `${PREFIX}-${Math.random()}`,
      avatarUrl: 'https://cdn.discordapp.com/avatars/1/ancien.png?size=128',
    });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            id: '1',
            avatar: 'a_nouveau',
            avatar_decoration_data: { asset: 'deco' },
          }),
        ),
    );

    expect(await refreshDiscordAccounts(0)).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.avatarUrl).toContain('a_nouveau.png');
    expect(user.avatarMotionUrl).toContain('a_nouveau.gif');
    const account = await db.linkedAccount.findFirstOrThrow({
      where: { userId: created.userId },
    });
    expect(account.frameMotionUrl).toContain('deco.png');

    expect(await refreshDiscordAccounts(0)).toBe(0);
    for (const { id: accountId, lastSyncedAt } of stale) {
      await db.linkedAccount.update({ where: { id: accountId }, data: { lastSyncedAt } });
    }
  });

  it('ne touche pas au cadre du site équipé', async () => {
    const id = identity({ frameUrl: 'https://a.test/cadre.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    const where = { id: created.userId };
    await db.user.update({ where, data: { frame: 'podium-1' } });

    await resolveIdentity({ ...id, frameUrl: null }, null);
    expect((await db.user.findUniqueOrThrow({ where })).frame).toBe('podium-1');
  });
});

describe('succès cachés Steam', () => {
  it('lit leur description dans la page du joueur', () => {
    const page = String.raw`{\"api_name\":\"BOSS\",\"name\":\"On répète\",\"description\":\"Éliminer le \\\"Polyèdre\\\"\",\"hidden\":true,\"icon\":\"a.jpg\"},{\"api_name\":\"VIDE\",\"name\":\"Rien\",\"description\":\"\",\"hidden\":true}`;
    const descriptions = parseSteamPage(page);
    expect(descriptions.get('BOSS')).toBe('Éliminer le "Polyèdre"');
    expect(descriptions.has('VIDE')).toBe(false);
  });
});

describe('saison', () => {
  const season = {
    startsAt: new Date('2026-06-01T00:00:00Z'),
    endsAt: new Date('2026-07-01T00:00:00Z'),
    goal: 100,
    tiers: [100, 500, 2_000],
    burstPerSecond: 3,
    burstPerMinute: 4,
    completionBonus: 500,
  } as const;

  async function player() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    return result.userId;
  }

  async function achievements(rarities: number[]) {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} saison`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return Promise.all(
      rarities.map((globalRarity, index) =>
        db.achievement.create({
          data: { gameId: game.id, platformAchievementId: String(index), name: 'S', globalRarity },
        }),
      ),
    );
  }

  const unlockFor = (userId: string) => (achievementId: string | undefined, unlockedAt: string) =>
    db.userAchievement.create({
      data: { userId, achievementId: achievementId as string, unlockedAt: new Date(unlockedAt) },
    });

  it('compte les jeux déjà commencés', async () => {
    const userId = await player();
    const [old, rare, rarer, common] = await achievements([90, 3, 2, 90]);
    const [fresh] = await achievements([3]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await unlock(rare?.id, '2026-06-10T12:00:00Z');
    await unlock(rarer?.id, '2026-06-10T13:00:00Z');
    await unlock(common?.id, '2026-06-11T12:00:00Z');
    await unlock(fresh?.id, '2026-06-12T12:00:00Z');

    const stats = await seasonStats(season);
    // 50 + 50 + 5 ; le jeu commencé en saison ne compte pas.
    expect(stats.ranking.find((row) => row.id === userId)?.points).toBe(105);
  });

  it('écarte les rafales et le bonus du jeu qu’elles terminent', async () => {
    const userId = await player();
    const [old, ...burst] = await achievements([90, 90, 90, 90]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await Promise.all(burst.map((item) => unlock(item.id, '2026-06-10T12:00:00Z')));
    if (!old) throw new Error('succès non créé');
    await db.userGame.create({
      data: {
        userId,
        gameId: old.gameId,
        completion: 100,
        unlockedCount: 4,
        totalCount: 4,
        lastUnlockedAt: new Date('2026-06-10T12:00:00Z'),
      },
    });

    const row = (await seasonStats(season)).ranking.find((item) => item.id === userId);
    expect(row).toMatchObject({ points: 0, ignored: 3 });
  });

  it('écarte aussi les rafales étalées sur une minute', async () => {
    const userId = await player();
    const [old, a, b, c, d] = await achievements([90, 90, 90, 90, 90]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await unlock(a?.id, '2026-06-10T12:00:01Z');
    await unlock(b?.id, '2026-06-10T12:00:11Z');
    await unlock(c?.id, '2026-06-10T12:00:21Z');
    await unlock(d?.id, '2026-06-10T12:00:31Z');

    const row = (await seasonStats(season)).ranking.find((item) => item.id === userId);
    expect(row).toMatchObject({ points: 0, ignored: 4 });
  });

  it('ne montre pas le badge quand seule une version jamais commencée reste à finir', async () => {
    const userId = await player();
    const key = `${PREFIX}-${Math.random()}`;
    const [started] = await achievements([90]);
    const [other] = await achievements([90, 90]);
    if (!started || !other) throw new Error('succès non créé');
    await db.game.updateMany({
      where: { id: { in: [started.gameId, other.gameId] } },
      data: { familyKey: key },
    });
    await db.game.update({ where: { id: other.gameId }, data: { platform: 'PSN' } });
    await unlockFor(userId)(started.id, '2020-01-01T12:00:00Z');
    await db.userGame.createMany({
      data: [
        { userId, gameId: started.gameId, completion: 100, unlockedCount: 1, totalCount: 1 },
        { userId, gameId: other.gameId, completion: 0, unlockedCount: 0, totalCount: 2 },
      ],
    });

    const { games } = await listGames({ sort: 'nom', page: 1, ownerId: userId }, userId);
    expect(games[0]?.seasonEligible).toBe(false);
  });

  it('garde les succès isolés', async () => {
    const userId = await player();
    const [old, a, b] = await achievements([90, 90, 90]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await unlock(a?.id, '2026-06-10T12:00:00Z');
    await unlock(b?.id, '2026-06-10T12:00:00Z');

    const row = (await seasonStats(season)).ranking.find((item) => item.id === userId);
    expect(row).toMatchObject({ points: 10, ignored: 0 });
  });
});

describe('rafraîchissement', () => {
  it('ne relit que les comptes qui n’ont pas été lus récemment', async () => {
    const result = await resolveIdentity(identity({ provider: 'STEAM' }), null);
    if (!result.ok) throw new Error('compte non créé');
    const { userId } = result;
    const run = await db.syncRun.create({
      data: { userId, provider: 'STEAM', status: 'COMPLETED' },
    });

    expect(await refreshAccounts(userId, 60_000)).toBe(0);
    await db.syncRun.update({
      where: { id: run.id },
      data: { startedAt: new Date(Date.now() - 120_000) },
    });
    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('IDLE');
    await db.linkedAccount.update({ where: { id: account.id }, data: { syncStatus: 'SYNCING' } });
    expect(await refreshAccounts(userId, 60_000)).toBe(0);
  });
});

describe('amis, clans et discussions', () => {
  async function players() {
    const player = async () => {
      const result = await resolveIdentity(identity(), null);
      if (!result.ok) throw new Error('compte non créé');
      return db.user.findUniqueOrThrow({ where: { id: result.userId } });
    };
    return [await player(), await player()] as const;
  }

  it('n’ouvre une discussion qu’entre amis, et le blocage la coupe', async () => {
    const [a, b] = await players();
    expect(await openDirect(a.id, b.id)).toBeNull();

    await requestFriend(a.id, b.handle);
    expect(await relationWith(a.id, b.id)).toBe('sent');
    expect(await openDirect(a.id, b.id)).toBeNull();
    await acceptFriend(b.id, a.id);

    const id = await openDirect(a.id, b.id);
    expect(id).toBeTruthy();
    expect(await openDirect(b.id, a.id)).toBe(id);

    expect(await sendMessage(a.id, id as string, 'Salut')).toMatchObject({ content: 'Salut' });
    expect(await unreadCount(b.id)).toBe(1);
    await readConversation(b.id, id as string);
    expect(await unreadCount(b.id)).toBe(0);

    await blockUser(b.id, a.id);
    expect(await sendMessage(a.id, id as string, 'Encore')).toBe('not_friends');
    expect(await requestFriend(a.id, b.handle)).toBe('not_found');
  });

  it('retire du badge une demande vue, sans la refuser', async () => {
    const [a, b] = await players();
    await requestFriend(a.id, b.handle);
    expect((await pendingInvites(b.id)).friends).toBe(1);

    await markInvitesSeen(b.id, 'friends');
    expect((await pendingInvites(b.id)).friends).toBe(0);
    expect(await relationWith(b.id, a.id)).toBe('received');
  });

  it('garde les discussions fermées aux autres joueurs', async () => {
    const [a, b] = await players();
    const [intruder] = await players();
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    const id = (await openDirect(a.id, b.id)) as string;
    const message = await sendMessage(a.id, id, 'Privé');
    if (typeof message === 'string') throw new Error('message refusé');

    expect(await readConversation(intruder.id, id)).toBeNull();
    expect(await sendMessage(intruder.id, id, 'Coucou')).toBe('not_found');
    expect(await reportMessage(intruder.id, message.id, 'Rien')).toBe(false);
    expect(await reportMessage(b.id, message.id, 'Insulte')).toBe(true);
  });

  const pendingMerge = async (sourceId: string, targetId: string) => {
    const provider = 'DISCORD' as const;
    const providerUserId = `${PREFIX}-${Math.random()}`;
    await db.linkedAccount.create({
      data: { userId: sourceId, provider, providerUserId, displayName: 'Preuve' },
    });
    await db.linkedAccount.deleteMany({
      where: { userId: { in: [sourceId, targetId] }, provider: { not: provider } },
    });
    return { sourceId, targetId, provider, providerUserId };
  };

  it('réunit les discussions avec un même ami à la fusion', async () => {
    const [source, target] = await players();
    const [friend] = await players();
    for (const user of [source, target]) {
      await requestFriend(user.id, friend.handle);
      await acceptFriend(friend.id, user.id);
    }
    const fromSource = (await openDirect(source.id, friend.id)) as string;
    const fromTarget = (await openDirect(target.id, friend.id)) as string;
    await sendMessage(source.id, fromSource, 'Ancien profil');
    await sendMessage(target.id, fromTarget, 'Profil gardé');

    expect(await mergeUsers(await pendingMerge(source.id, target.id))).toBeNull();

    const conversation = await readConversation(target.id, fromTarget);
    expect(conversation?.messages.map((message) => message.content)).toEqual([
      'Ancien profil',
      'Profil gardé',
    ]);
    expect(await openDirect(target.id, friend.id)).toBe(fromTarget);
    expect(await relationWith(target.id, friend.id)).toBe('friends');
  });

  it('demande quel clan garder, puis garde celui choisi', async () => {
    const [source, target] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    await createClan(source.id, `${name}a`);
    await createClan(target.id, `${name}b`);
    const merge = await pendingMerge(source.id, target.id);

    expect(await mergeUsers(merge)).toBe('clan_choice');
    expect(await mergeUsers(merge, 'source')).toBeNull();

    const clan = await db.clanMember.findUnique({
      where: { userId: target.id },
      select: { owner: true, clan: { select: { name: true } } },
    });
    expect(clan).toEqual({ owner: true, clan: { name: `${name}a` } });
    expect(await db.clan.findUnique({ where: { name: `${name}b` } })).toBeNull();
  });

  it('additionne les succès des membres publics d’un clan', async () => {
    const [a, b] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    await createClan(a.id, name);
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    const { id: clanId, slug } = await db.clan.findUniqueOrThrow({ where: { name } });
    await inviteToClan(a.id, b.id);
    await acceptClanInvite(b.id, clanId);
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} clan`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const achievement = await db.achievement.create({
      data: { gameId: game.id, platformAchievementId: '0', name: 'A' },
    });
    for (const user of [a, b]) {
      await db.userAchievement.create({
        data: { userId: user.id, achievementId: achievement.id, unlockedAt: new Date() },
      });
    }

    expect((await clanPage(slug))?.achievements).toBe(2);
    await db.user.update({ where: { id: b.id }, data: { isPublic: false } });
    const page = await clanPage(slug);
    expect(page?.achievements).toBe(1);
    expect(page?.members).toHaveLength(1);
  });

  it('transmet le clan au plus ancien membre, puis le supprime quand il est vide', async () => {
    const [a, b] = await players();
    expect(await inviteToClan(a.id, b.id)).toBe('owner_only');
    const name = `${PREFIX} ${Math.random()}`;
    expect(await createClan(a.id, name)).toBeNull();
    expect(await createClan(a.id, `${name}2`)).toBe('in_clan');

    expect(await inviteToClan(a.id, b.id)).toBe('not_friends');
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    expect(await inviteToClan(a.id, b.id)).toBeNull();
    const clan = await db.clan.findUniqueOrThrow({ where: { name } });
    expect(await acceptClanInvite(b.id, clan.id)).toBeNull();

    await leaveClan(a.id);
    expect(await db.clanMember.findUnique({ where: { userId: b.id } })).toMatchObject({
      owner: true,
    });
    await leaveClan(b.id);
    expect(await db.clan.findUnique({ where: { name } })).toBeNull();
  });

  it('accorde un palier de clan dès l’arrivée du membre qui le fait franchir', async () => {
    const [a, b] = await players();
    const [c] = await players();
    const name = `${PREFIX} ${Math.random()}`;
    expect(await createClan(a.id, name)).toBeNull();
    const { id } = await db.clan.findUniqueOrThrow({ where: { name } });
    for (const friend of [b, c]) {
      await requestFriend(a.id, friend.handle);
      await acceptFriend(friend.id, a.id);
      await inviteToClan(a.id, friend.id);
      expect(await acceptClanInvite(friend.id, id)).toBeNull();
    }
    expect(await db.clanUnlock.count({ where: { clanId: id, code: 'band_3' } })).toBe(1);
    for (const member of [a, b, c]) {
      expect(await db.siteUnlock.count({ where: { userId: member.id, code: 'band_3' } })).toBe(1);
    }
    for (const member of [c, b, a]) await leaveClan(member.id);
  });

  it('retire un nom grossier et laisse le chef en choisir un autre', async () => {
    const [a, b] = await players();
    const name = `Zgeg ${Math.random().toString(36).slice(2, 8)}`;
    expect(await createClan(a.id, name)).toBeNull();
    const { id } = await db.clan.findUniqueOrThrow({ where: { name } });
    await requestFriend(a.id, b.handle);
    await acceptFriend(b.id, a.id);
    await inviteToClan(a.id, b.id);
    await acceptClanInvite(b.id, id);

    expect(await flagProfaneClans()).toBeGreaterThanOrEqual(1);
    const flagged = await db.clan.findUniqueOrThrow({ where: { id } });
    expect(flagged).toMatchObject({ flaggedName: name });
    expect(flagged.name).toMatch(/^Clan #/);
    expect(await flagClanName(id)).toBe(false);
    expect((await pendingInvites(a.id)).clans).toBeGreaterThanOrEqual(1);

    expect(await renameClan(b.id, `${PREFIX} propre`)).toBe('owner_only');
    const fresh = `${PREFIX} ${Math.random()}`;
    expect(await renameClan(a.id, fresh)).toBeNull();
    expect(await db.clan.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: fresh,
      flaggedName: null,
    });
    await leaveClan(b.id);
    await leaveClan(a.id);
  });
});

describe('notifications', () => {
  async function subscribed() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    const session = await db.session.create({
      data: {
        id: `${PREFIX}-${Math.random()}`,
        userId: result.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await db.pushSubscription.create({
      data: {
        userId: result.userId,
        sessionId: session.id,
        endpoint: `https://push.exemple/${Math.random()}`,
        p256dh: 'p',
        auth: 'a',
        locale: 'fr',
      },
    });
    return { userId: result.userId, session };
  }

  it('ne sonne qu’une fois par discussion', async () => {
    const { userId } = await subscribed();
    expect(await subscribersToNotify(userId, 'message', 'c1')).toHaveLength(1);
    expect(await subscribersToNotify(userId, 'message', 'c1')).toHaveLength(0);
    expect(await subscribersToNotify(userId, 'message', 'c2')).toHaveLength(1);
  });

  it('se tait pendant que le joueur regarde le site', async () => {
    const { userId } = await subscribed();
    markActive(userId);
    expect(await subscribersToNotify(userId, 'invite', 'a')).toHaveLength(0);
  });

  it('prépare un résumé une fois le joueur parti, et une seule fois', async () => {
    const { userId } = await subscribed();
    markActive(userId);
    await subscribersToNotify(userId, 'message', 'c1');
    expect(usersWhoLeft()).not.toContain(userId);

    markActive(userId, Date.now() - 120_000);
    expect(usersWhoLeft()).toContain(userId);
    expect(usersWhoLeft()).not.toContain(userId);
    expect(await subscribersToNotify(userId, 'digest', 'resume')).toHaveLength(1);
  });

  it('respecte les préférences et la limite horaire', async () => {
    const { userId } = await subscribed();
    await db.user.update({ where: { id: userId }, data: { pushInvites: false } });
    expect(await subscribersToNotify(userId, 'invite', 'a')).toHaveLength(0);

    const sent = [];
    for (let index = 0; index < 12; index++) {
      sent.push((await subscribersToNotify(userId, 'event', String(index))).length);
    }
    expect(sent.reduce((sum, count) => sum + count, 0)).toBe(8);
  });

  it('s’arrête quand la session se ferme', async () => {
    const { userId, session } = await subscribed();
    await db.session.delete({ where: { id: session.id } });
    expect(await subscribersToNotify(userId, 'event', 'a')).toHaveLength(0);
  });
});

describe('fil de la communauté', () => {
  it('classe uniquement les joueurs demandés', async () => {
    const rows = await db.user.findMany({
      where: { handle: { in: ['demo', 'lea'] } },
      select: { id: true, handle: true },
    });
    const lea = rows.find((row) => row.handle === 'lea')?.id as string;
    const ranking = await leaderboard('tout', 20, [lea]);
    expect(ranking.map((row) => row.handle)).toEqual(['lea']);
    expect(await leaderboard('tout', 20, [])).toEqual([]);
  });

  it('signale un exploit récent, pas un succès banal', async () => {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('compte non créé');
    const game = await db.game.create({
      data: {
        platform: 'PSN',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} exploit`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const add = async (id: string, globalRarity: number) => {
      const achievement = await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: id, name: id, globalRarity },
      });
      await db.userAchievement.create({
        data: { userId: created.userId, achievementId: achievement.id, unlockedAt: new Date() },
      });
    };
    const since = new Date(Date.now() - 60_000);
    await add('banal', 40);
    expect(await hasRecentFeat(created.userId, game.id, since)).toBe(false);
    await add('rare', 0.5);
    expect(await hasRecentFeat(created.userId, game.id, since)).toBe(true);
  });

  it('annonce chaque niveau d’une carte, une fois', async () => {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('compte non créé');
    const family = `${PREFIX}-${Math.random()}`;
    const finish = async (platform: 'STEAM' | 'PSN', suffix: string, date: string) => {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} niveaux`,
          slug: `${PREFIX}-niveaux-${suffix}-${Math.random().toString(36).slice(2)}`,
          familyKey: family,
          contentCheckedAt: new Date(),
        },
      });
      await db.userGame.create({
        data: {
          userId: created.userId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 1,
          totalCount: 1,
          lastUnlockedAt: new Date(date),
        },
      });
    };
    await finish('STEAM', 'a', '2030-01-01T00:00:00Z');
    await finish('STEAM', 'b', '2030-01-02T00:00:00Z');
    await finish('PSN', 'c', '2030-01-03T00:00:00Z');

    const moments = (await highlights(false, 30)).flatMap((item) =>
      item.kind === 'card' && item.game.name === `${PREFIX} niveaux` ? [item.copies] : [],
    );
    expect(moments).toEqual([2, 1]);
  });

  it('ne garde dans le global que les exploits et les jeux terminés', async () => {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('compte non créé');
    const userId = created.userId;
    const game = await db.game.create({
      data: {
        platform: 'PSN',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} fil`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const add = async (name: string, globalRarity: number, trophyType: 'BRONZE' | 'PLATINUM') => {
      const achievement = await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: name, name, globalRarity, trophyType },
      });
      await db.userAchievement.create({
        data: { userId, achievementId: achievement.id, unlockedAt: new Date(Date.now() + 60_000) },
      });
    };
    await add(`${PREFIX}-banal`, 40, 'BRONZE');
    await add(`${PREFIX}-rare`, 0.5, 'BRONZE');
    await add(`${PREFIX}-platine`, 30, 'PLATINUM');

    const names = (await activityFeed(false, { feats: true, limit: 200 })).map(
      (row) => row.achievement.name,
    );
    expect(names).toContain(`${PREFIX}-rare`);
    expect(names).toContain(`${PREFIX}-platine`);
    expect(names).not.toContain(`${PREFIX}-banal`);

    expect(await activityFeed(false, { userIds: [] })).toEqual([]);
    expect(await activityFeed(false, { userIds: [userId] })).toHaveLength(3);
  });
});

describe('création de compte', () => {
  it('reprend l’avatar animé et le cadre du compte', async () => {
    const look = {
      avatarUrl: 'https://exemple.fr/avatar.png',
      avatarMotionUrl: 'https://exemple.fr/avatar.gif',
      frameUrl: 'https://exemple.fr/cadre.png',
      frameMotionUrl: 'https://exemple.fr/cadre.gif',
    };
    const result = await resolveIdentity(identity(look), null);
    if (!result.ok) throw new Error('compte non créé');
    const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user).toMatchObject({
      avatarUrl: look.avatarUrl,
      avatarMotionUrl: look.avatarMotionUrl,
      frame: look.frameUrl,
      frameMotionUrl: look.frameMotionUrl,
    });
  });
});

describe('guides officiels', () => {
  const file = (text: string) => `STEAM ${PREFIX}-guides\n\n@@ A1\n${text}\n\n@@ INCONNU\nRien.\n`;

  it('lit un fichier de guides', () => {
    expect(parseGuideFile('STEAM 42\n@@ A\n## Un\n\ntexte\n\n@@ B\nDeux\n')).toEqual({
      platform: 'STEAM',
      gameId: '42',
      guides: [
        { achievementId: 'A', content: '## Un\n\ntexte' },
        { achievementId: 'B', content: 'Deux' },
      ],
    });
  });

  it('suit le dépôt : ajoute, met à jour, puis retire', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-guides`,
        name: `${PREFIX} guides`,
        slug: `${PREFIX}-guides`,
      },
    });
    const achievement = await db.achievement.create({
      data: { gameId: game.id, platformAchievementId: 'A1', name: 'A' },
    });
    const guides = () => db.guide.findMany({ where: { achievementId: achievement.id } });

    await syncCuratedGuides([file('Première version.')]);
    expect((await guides()).map((g) => g.contentMd)).toEqual(['Première version.']);

    await syncCuratedGuides([file('Deuxième version.')]);
    expect((await guides()).map((g) => g.contentMd)).toEqual(['Deuxième version.']);

    await syncCuratedGuides([]);
    expect(await guides()).toEqual([]);
  });
});

describe('filtres par niveau', () => {
  async function library(extraCards = 0) {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    const userId = result.userId;
    const add = async (
      name: string,
      platform: 'STEAM' | 'PSN',
      completion: number,
      familyKey?: string,
      tier?: number,
    ) => {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          familyKey,
          tier,
        },
      });
      await db.userGame.create({
        data: { userId, gameId: game.id, completion, unlockedCount: 0, totalCount: 10 },
      });
    };
    const key = () => `${PREFIX}-${Math.random()}`;
    const platinum = key();
    const gold = key();
    await add('platine', 'STEAM', 100, platinum, 4);
    await add('platine', 'PSN', 100, platinum, 4);
    await add('or', 'STEAM', 100, gold);
    await add('or', 'PSN', 40, gold);
    await add('or seul', 'STEAM', 100);
    await add('presque', 'STEAM', 90);
    await add('debut', 'PSN', 10);
    for (let index = 0; index < extraCards; index++) await add(`carte ${index}`, 'STEAM', 100);
    return { sort: 'progression', page: 1, ownerId: userId } as const;
  }
  it('classe les cartes par niveau, puis par avancée vers l’exemplaire suivant', async () => {
    const { ownerId } = await library();
    const cards = await userCards(ownerId);
    expect(cards.map((card) => card.name)).toEqual([
      `${PREFIX} platine`,
      `${PREFIX} or`,
      `${PREFIX} or seul`,
    ]);
    expect(cards[1]?.next?.completion).toBe(40);
  });

  it('trie les jeux à finir par carte à gagner, la plus proche d’abord', async () => {
    const { ownerId } = await library();
    for (const [name, tier, completion] of [
      ['légendaire', 6, 20],
      ['prismatique loin', 5, 30],
      ['prismatique proche', 5, 80],
    ] as const) {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          tier,
        },
      });
      await db.userGame.create({
        data: { userId: ownerId, gameId: game.id, completion, unlockedCount: 1, totalCount: 10 },
      });
    }
    const { games } = await listGames(
      { sort: 'rarete', page: 1, ownerId, status: 'restants' },
      ownerId,
    );
    expect(games.slice(0, 4).map((game) => game.name)).toEqual([
      `${PREFIX} légendaire`,
      `${PREFIX} prismatique proche`,
      `${PREFIX} prismatique loin`,
      `${PREFIX} presque`,
    ]);
  });

  it('met les exemplaires multiples devant une carte rare seule', async () => {
    const { ownerId } = await library();
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} prismatique seul`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        totalAchievements: 10,
        tier: 5,
      },
    });
    await db.userGame.create({
      data: {
        userId: ownerId,
        gameId: game.id,
        completion: 100,
        unlockedCount: 10,
        totalCount: 10,
      },
    });
    const { games } = await listGames({ sort: 'progression', page: 1, ownerId }, ownerId);
    expect(games.slice(0, 2).map((card) => card.name)).toEqual([
      `${PREFIX} platine`,
      `${PREFIX} prismatique seul`,
    ]);
  });

  it('combine « Non 100 % » et un niveau : la carte à gagner compte', async () => {
    const { ownerId } = await library();
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} légendaire à finir`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        totalAchievements: 10,
        tier: 6,
      },
    });
    await db.userGame.create({
      data: { userId: ownerId, gameId: game.id, completion: 30, unlockedCount: 3, totalCount: 10 },
    });
    const { games } = await listGames(
      { sort: 'progression', page: 1, ownerId, status: 'restants', tier: 6 },
      ownerId,
    );
    expect(games.map((card) => card.name)).toEqual([`${PREFIX} légendaire à finir`]);
  });

  it('range un jeu selon sa rareté, fini ou non, quel que soit le statut', async () => {
    const { ownerId } = await library();
    for (const [name, completion] of [
      ['légendaire fini', 100],
      ['légendaire commencé', 40],
    ] as const) {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          tier: 6,
        },
      });
      await db.userGame.create({
        data: { userId: ownerId, gameId: game.id, completion, unlockedCount: 4, totalCount: 10 },
      });
    }
    const list = async (status?: 'termines' | 'restants') =>
      (await listGames({ sort: 'nom', page: 1, ownerId, status, tier: 6 }, ownerId)).games.map(
        (card) => card.name.replace(`${PREFIX} `, ''),
      );
    expect(await list()).toEqual(['légendaire commencé', 'légendaire fini']);
    expect(await list('termines')).toEqual(['légendaire fini']);
    expect(await list('restants')).toEqual(['légendaire commencé']);
  });

  it('filtre par console PlayStation, une liste partagée comptant pour chacune', async () => {
    const { ownerId } = await library();
    for (const [name, console] of [
      ['cross-gen', 'PS4/PS5'],
      ['ancien', 'PS3'],
    ] as const) {
      const game = await db.game.create({
        data: {
          platform: 'PSN',
          console,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
        },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 50,
          unlockedCount: 5,
          totalCount: 10,
        },
      });
    }
    const names = async (console: string) =>
      (
        await listGames(
          { sort: 'nom', page: 1, ownerId, platform: 'PSN', consoles: [console] },
          ownerId,
        )
      ).games.map((game) => game.name);
    expect(await names('PS5')).toEqual([`${PREFIX} cross-gen`]);
    expect(await names('PS4')).toEqual([`${PREFIX} cross-gen`]);
    expect(await names('PS3')).toEqual([`${PREFIX} ancien`]);
  });

  it('garde le niveau d’une carte quand la recherche ne vise qu’une version', async () => {
    const { ownerId } = await library();
    const family = `${PREFIX}-${Math.random()}`;
    const names = ['Royal', 'Classique'];
    for (const [index, platform] of (['STEAM', 'PSN'] as const).entries()) {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${names[index]}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          familyKey: family,
        },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
        },
      });
    }
    const { games } = await listGames({ sort: 'nom', page: 1, ownerId, q: 'classique' }, ownerId);
    expect(games).toHaveLength(1);
    expect(games[0]?.copies).toBe(2);
  });

  it('garde les jeux cachés et non classés hors des fils publics', async () => {
    const { ownerId } = await library();
    await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });
    const add = async (name: string, contentCheckedAt: Date | null, hidden: boolean) => {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          contentCheckedAt,
        },
      });
      const achievement = await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: '0', name },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 1,
          totalCount: 1,
          hidden,
          lastUnlockedAt: new Date(Date.now() + 60_000),
        },
      });
      await db.userAchievement.create({
        data: {
          userId: ownerId,
          achievementId: achievement.id,
          unlockedAt: new Date(Date.now() + 60_000),
        },
      });
    };
    await add('visible', new Date(), false);
    await add('secret', new Date(), true);
    await add('non classe', null, false);

    const feed = (await activityFeed()).map((row) => row.achievement.name);
    expect(feed).toContain('visible');
    expect(feed).not.toContain('secret');
    expect(feed).not.toContain('non classe');
    const cards = (await cardFeed()).map((row) => row.game.name);
    expect(cards).toContain(`${PREFIX} visible`);
    expect(cards).not.toContain(`${PREFIX} non classe`);
  });

  it('classe les collections selon leurs cartes, jeux réunis', async () => {
    const { ownerId } = await library();
    const user = await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });
    const row = (await collectors(10_000)).find((entry) => entry.handle === user.handle);
    expect(row).toMatchObject({ cards: 3, tiers: [2, 0, 0, 1, 0, 0], score: 350 });
  });

  it('attribue une fois les cadres, et les garde', async () => {
    const { ownerId } = await library(7);
    await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });

    await grantFrames();
    await grantFrames();
    const owned = await db.userFrame.findMany({ where: { userId: ownerId, frame: 'collector' } });
    expect(owned).toHaveLength(1);

    await db.userGame.deleteMany({ where: { userId: ownerId } });
    await grantFrames();
    expect(await db.userFrame.count({ where: { userId: ownerId, frame: 'collector' } })).toBe(1);
  });

  const names = (result: Awaited<ReturnType<typeof listGames>>) =>
    result.games.map((game) => game.name.replace(`${PREFIX} `, ''));

  it('garde le niveau de la carte quand on filtre par plateforme', async () => {
    const filters = await library();
    const steam = await listGames({ ...filters, platform: 'STEAM', tier: 4 }, filters.ownerId);
    expect(names(steam)).toEqual(['platine']);
  });

  it('place chaque carte selon son avancée vers l’exemplaire suivant', async () => {
    const filters = await library();
    expect(names(await listGames(filters, filters.ownerId))).toEqual([
      'platine',
      'or',
      'or seul',
      'presque',
      'debut',
    ]);
  });

  it('garde dans « Non 100 % » les cartes dont une autre version avance', async () => {
    const filters = await library();
    const unfinished = await listGames({ ...filters, status: 'restants' }, filters.ownerId);
    expect(names(unfinished)).toEqual(['presque', 'or', 'debut']);
  });
});

describe('textes officiels des succès', () => {
  it('demande une fois les textes d’un jeu, puis les affiche', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: '424242',
        name: `${PREFIX} textes`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const achievement = await db.achievement.create({
      data: {
        gameId: game.id,
        platformAchievementId: 'BOSS',
        name: 'Le boss',
        description: 'Bats le boss',
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            game: {
              availableGameStats: {
                achievements: [{ name: 'BOSS', displayName: 'The boss', description: 'Beat it' }],
              },
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await ensureGameTexts(game, 'en');
    await ensureGameTexts(game, 'en');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [text] = await localizeAchievements([achievement], 'en');
    expect(text).toMatchObject({ name: 'The boss', description: 'Beat it' });
    const [french] = await localizeAchievements([achievement], 'fr');
    expect(french?.name).toBe('Le boss');
  });
});

describe('succès du site', () => {
  async function player(handle: string) {
    return db.user.create({ data: { handle, displayName: handle } });
  }

  async function withAccount(handle: string) {
    const user = await player(handle);
    await db.linkedAccount.create({
      data: { userId: user.id, provider: 'STEAM', providerUserId: handle, displayName: handle },
    });
    return user;
  }

  it('reste muet la première fois, puis annonce la suite', async () => {
    const user = await withAccount(`${PREFIX}-succes1`);
    const heard: unknown[] = [];
    const stop = onChat(user.id, (event) => heard.push(event));

    expect(await checkSiteAchievements(user.id)).toContain('first_account');
    expect(heard).toEqual([]);
    expect(await checkSiteAchievements(user.id)).toEqual([]);

    await db.user.update({ where: { id: user.id }, data: { showcaseCustom: true } });
    expect(await checkSiteAchievements(user.id)).toEqual(['storefront']);
    expect(heard).toEqual([{ type: 'site-achievement', codes: ['storefront'] }]);

    await grantSiteAchievement(user.id, 'deserter');
    await grantSiteAchievement(user.id, 'deserter');
    expect(heard).toHaveLength(2);
    stop();
  });

  it('garde un succès acquis et le secret de celui qui ne le connaît pas', async () => {
    const owner = await withAccount(`${PREFIX}-succes2`);
    const viewer = await player(`${PREFIX}-succes3`);
    await checkSiteAchievements(owner.id);
    await grantSiteAchievement(owner.id, 'deserter');
    await db.linkedAccount.deleteMany({ where: { userId: owner.id } });
    await checkSiteAchievements(owner.id);

    const find = (board: Awaited<ReturnType<typeof siteAchievementBoard>>, category: string) =>
      board.categories.find((entry) => entry.category === category)?.items ?? [];

    const seenByViewer = await siteAchievementBoard(owner.id, viewer.id);
    expect(seenByViewer.earned).toBe(2);
    expect(seenByViewer.total).toBe(SITE_TOTAL);
    expect(find(seenByViewer, 'start')[0]?.unlockedAt).toBeTruthy();
    const hidden = find(seenByViewer, 'secret').filter((item) => item.unlockedAt);
    expect(hidden).toEqual([
      expect.objectContaining({ title: null, text: null, rarity: null, icon: UNKNOWN_ICON }),
    ]);

    const seenByOwner = await siteAchievementBoard(owner.id, owner.id);
    expect(find(seenByOwner, 'secret').filter((item) => item.title)).toHaveLength(1);
  });

  it('compte tous les joueurs, même ceux qui ne reviennent pas', async () => {
    const active = await withAccount(`${PREFIX}-succes7`);
    const absent = await withAccount(`${PREFIX}-succes8`);
    await checkSiteAchievements(active.id);

    const rate = async () => {
      const board = await siteAchievementBoard(active.id, active.id);
      const [first] = board.categories.find((entry) => entry.category === 'start')?.items ?? [];
      return first?.rarity ?? 0;
    };
    expect(await rate()).toBeLessThan(100);

    await db.siteUnlock.deleteMany({ where: { userId: absent.id } });
    await reviewNewPlayers();
    expect(await db.siteUnlock.count({ where: { userId: absent.id } })).toBeGreaterThan(0);
  });

  it("montre les jeux d'un autre joueur, et ses secrets seulement à qui les a aussi", async () => {
    const owner = await player(`${PREFIX}-succes9`);
    const viewer = await player(`${PREFIX}-succes10`);
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-succes`,
        name: `${PREFIX} preuve`,
        slug: `${PREFIX}-preuve`,
      },
    });
    const proof = { games: [game.id] };
    await db.siteUnlock.createMany({
      data: [
        { userId: owner.id, code: 'cards_1', proof },
        { userId: owner.id, code: 'friday13', proof },
      ],
    });
    const items = async (viewerId: string | null) => {
      const { categories } = await siteAchievementBoard(owner.id, viewerId);
      return categories.flatMap((entry) => entry.items).filter((item) => item.unlockedAt);
    };
    const slugs = (list: Awaited<ReturnType<typeof items>>) =>
      list.map((item) => item.proof?.games[0]?.slug ?? null);

    expect(slugs(await items(viewer.id)).toSorted()).toEqual([game.slug, null].toSorted());
    expect(slugs(await items(null)).filter(Boolean)).toEqual([game.slug]);

    await db.siteUnlock.create({ data: { userId: viewer.id, code: 'friday13' } });
    expect(slugs(await items(viewer.id))).toEqual([game.slug, game.slug]);
  });

  it('accorde les dix secrets au Dernier mot', async () => {
    const user = await withAccount(`${PREFIX}-succes4`);
    await checkSiteAchievements(user.id);
    await db.siteUnlock.createMany({
      data: [
        'midnight',
        'friday13',
        'birthday',
        'grand_slam',
        'christmas',
        'new_year',
        'monk',
        'forty_two',
        'hare',
        'twins',
      ].map((code) => ({ userId: user.id, code })),
    });
    expect(await checkSiteAchievements(user.id)).toEqual(['last_word']);
  });

  const gameFor = (name: string, tags: number[] = []) =>
    db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} ${name}`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        totalAchievements: 10,
        tags,
      },
    });
  const unique = (name: string) => `${PREFIX}-${name}-${Math.random().toString(36).slice(2, 8)}`;

  it('regroupe les paliers et propose des jeux pour avancer', async () => {
    const owner = await withAccount(unique('paliers'));
    const zombie = GENRES.zombies.tags[0];
    const near = await gameFor('zombies proche', [zombie]);
    const far = await gameFor('zombies loin', [zombie]);
    const other = await gameFor('autre');
    for (const [game, completion] of [
      [near, 80],
      [far, 20],
      [other, 90],
    ] as const) {
      await db.userGame.create({
        data: {
          userId: owner.id,
          gameId: game.id,
          completion,
          unlockedCount: completion / 10,
          totalCount: 10,
        },
      });
    }
    await db.siteUnlock.create({ data: { userId: owner.id, code: 'g_zombies_1' } });

    const { categories } = await siteAchievementBoard(owner.id, owner.id);
    const genres = categories.find((entry) => entry.category === 'genres')!;
    const zombies = genres.items.filter((item) => item.code?.startsWith('g_zombies_'));
    expect(zombies).toHaveLength(1);
    expect(zombies[0]).toMatchObject({ code: 'g_zombies_5', suggest: true, complete: false });
    expect(zombies[0]?.steps.map((step) => step.earned)).toEqual([true, false, false]);
    expect(
      (await siteAchievementBoard(owner.id, null)).categories.flatMap((c) => c.items),
    ).not.toContainEqual(expect.objectContaining({ suggest: true }));

    const ideas = await siteSuggestions(owner.id, 'g_zombies_5');
    expect(ideas?.owned).toBe(true);
    expect(ideas?.games.map((game) => game.name)).toEqual([
      `${PREFIX} zombies proche`,
      `${PREFIX} zombies loin`,
    ]);
    expect(await siteSuggestions(owner.id, 'makeover')).toBeNull();
  });

  it('compte les jeux finis à deux entre amis', async () => {
    const me = await withAccount(unique('duo-a'));
    const friend = await player(unique('duo-b'));
    await db.friendship.create({
      data: { requesterId: me.id, addresseeId: friend.id, accepted: true },
    });
    const game = await gameFor('duo');
    const day = 24 * 60 * 60 * 1000;
    for (const [userId, ago] of [
      [me.id, 0],
      [friend.id, 2 * day],
    ] as const) {
      await db.userGame.create({
        data: {
          userId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
          lastUnlockedAt: new Date(Date.now() - ago),
        },
      });
    }
    await checkSiteAchievements(me.id);
    const codes = (await db.siteUnlock.findMany({ where: { userId: me.id } })).map(
      (row) => row.code,
    );
    expect(codes).toEqual(expect.arrayContaining(['duo_1', 'revenge_1', 'teammates_1']));
    expect(codes).not.toContain('duo_5');
  });

  it('donne les succès de clan aux membres du moment, pas aux suivants', async () => {
    const [a, b, c, late] = await Promise.all(
      ['a', 'b', 'c', 'late'].map((name) => player(unique(`clan-${name}`))),
    );
    const clan = await db.clan.create({
      data: {
        name: unique('clan'),
        slug: unique('clan'),
        members: {
          create: [a!, b!, c!].map((user, index) => ({ userId: user.id, owner: index === 0 })),
        },
      },
    });
    const game = await gameFor('raid');
    for (const user of [a!, b!, c!]) {
      await db.userGame.create({
        data: {
          userId: user.id,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
          lastUnlockedAt: new Date(),
        },
      });
    }
    // Quatre succès déjà gagnés : le cinquième apporte le premier cadre.
    await db.clanUnlock.createMany({
      data: ['guild_50000', 'band_25', 'loyal', 'marathon_100'].map((code) => ({
        clanId: clan.id,
        code,
      })),
    });
    const gained = await checkClanAchievements(clan.id);
    expect(gained).toEqual(expect.arrayContaining(['band_3', 'raid_3', 'nobody_behind']));
    expect(
      await db.clan.findUniqueOrThrow({ where: { id: clan.id }, select: { frame: true } }),
    ).toEqual({
      frame: 'clan-1',
    });
    expect(await db.userFrame.count({ where: { userId: c!.id, frame: 'clan-1' } })).toBe(1);
    expect(gained).not.toContain('raid_5');
    expect(await db.siteUnlock.count({ where: { userId: b!.id, code: 'raid_3' } })).toBe(1);

    await db.clanMember.create({ data: { userId: late!.id, clanId: clan.id } });
    await checkClanAchievements(clan.id);
    expect(await db.siteUnlock.count({ where: { userId: late!.id, code: 'raid_3' } })).toBe(0);

    const board = await clanAchievementBoard(clan.id);
    expect(board.items.find((item) => item.code.startsWith('band_'))).toMatchObject({
      code: 'band_10',
      progress: { value: 4, goal: 10 },
    });
  });
});

describe('jeton PSN du site', () => {
  const DAY = 24 * 60 * 60 * 1000;
  afterEach(async () => {
    await db.serviceToken.deleteMany();
    await db.announcement.deleteMany({ where: { key: { startsWith: 'jeton:' } } });
  });

  it('compte ses 60 jours depuis sa mise en service, et repart à zéro avec un nouveau', async () => {
    const start = new Date('2026-11-01T00:00:00Z');
    await notePsnToken('ancien', undefined, start);
    await notePsnToken('ancien', undefined, new Date(start.getTime() + 10 * DAY));

    const state = await psnTokenState(start.getTime() + 10 * DAY);
    expect(state).toMatchObject({ since: start, daysLeft: 50, failing: false, warn: false });
    expect((await psnTokenState(start.getTime() + 40 * DAY))?.warn).toBe(true);

    // L'empreinte seule est gardée : jamais le jeton.
    const row = await db.serviceToken.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('ancien');

    const later = new Date(start.getTime() + 45 * DAY);
    await notePsnToken('nouveau', undefined, later);
    expect(await psnTokenState(later.getTime())).toMatchObject({ since: later, daysLeft: 60 });
  });

  it('signale un refus de Sony, puis le lève au prochain échange réussi', async () => {
    await notePsnToken('jeton', 'Is your NPSSO code valid?');
    expect(await psnTokenState()).toMatchObject({ failing: true, warn: true });
    await notePsnToken('jeton');
    expect(await psnTokenState()).toMatchObject({ failing: false, warn: false });
  });

  it("ne prévient qu'une fois par étape", async () => {
    await notePsnToken('jeton', 'Is your NPSSO code valid?');
    await warnPsnToken();
    await warnPsnToken();
    const keys = await db.announcement.findMany({ where: { key: { startsWith: 'jeton:' } } });
    expect(keys.map((a) => a.key)).toEqual([expect.stringMatching(/^jeton:[0-9a-f]{16}:refuse$/)]);
  });
});
