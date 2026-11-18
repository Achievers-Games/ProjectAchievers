// Données de démonstration, pour le développement uniquement.
import 'dotenv/config';
import { sharedTierUpdate } from '../src/lib/server/card-rarity';
import { familyKey } from '../src/lib/server/family';
import { type TrophyType } from '#prisma';
import { createPrismaClient } from '../src/lib/server/prisma';

const db = createPrismaClient();

if (process.env.NODE_ENV === 'production') {
  throw new Error('Le seed de démonstration ne doit pas tourner en production.');
}

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

const GAMES = [
  { id: '1245620', name: 'Elden Ring', count: 42 },
  { id: '1091500', name: 'Cyberpunk 2077', count: 57 },
  { id: '292030', name: 'The Witcher 3: Wild Hunt', count: 78 },
  { id: '1145360', name: 'Hades', count: 49 },
  { id: '367520', name: 'Hollow Knight', count: 63 },
  { id: '413150', name: 'Stardew Valley', count: 49 },
  { id: '620', name: 'Portal 2', count: 51 },
  { id: '1086940', name: "Baldur's Gate 3", count: 54 },
];

const USERS = [
  { handle: 'demo', displayName: 'Demo', share: 0.8, role: 'ADMIN' as const },
  { handle: 'lea', displayName: 'Léa', share: 0.55, role: 'USER' as const },
  { handle: 'marco', displayName: 'Marco', share: 0.35, role: 'USER' as const },
];

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, '');

async function main() {
  const users = [];
  for (const u of USERS) {
    users.push(
      await db.user.upsert({
        where: { handle: u.handle },
        update: {},
        create: { handle: u.handle, displayName: u.displayName, role: u.role },
      }),
    );
  }

  for (const [gameIndex, g] of GAMES.entries()) {
    const game = await db.game.upsert({
      where: { platform_platformGameId: { platform: 'STEAM', platformGameId: g.id } },
      update: {},
      create: {
        platform: 'STEAM',
        platformGameId: g.id,
        name: g.name,
        slug: slug(g.name),
        coverUrl: `${CDN}/${g.id}/library_600x900.jpg`,
        headerUrl: `${CDN}/${g.id}/header.jpg`,
        ...(g.id === '367520' && {
          heroUrl:
            'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/0daf3933d392d7bb7c5a890917e20c917fcc458e/library_hero.jpg',
          artUrl:
            'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/ss_5384f9f8b96a0b9934b2bc35a4058376211636d2.1920x1080.jpg',
        }),
        totalAchievements: g.count,
        schemaSyncedAt: new Date(),
      },
    });

    const achievements = [];
    for (let i = 0; i < g.count; i++) {
      const trophyType: TrophyType = 'ACHIEVEMENT';
      achievements.push(
        await db.achievement.upsert({
          where: {
            gameId_platformAchievementId: { gameId: game.id, platformAchievementId: `A${i}` },
          },
          update: {},
          create: {
            gameId: game.id,
            platformAchievementId: `A${i}`,
            name: `${g.name.split(':')[0]} — étape ${i + 1}`,
            description: `Atteindre l'objectif numéro ${i + 1} du jeu.`,
            trophyType,
            hidden: i === g.count - 1,
            globalRarity: Math.max(0.6, 92 - (i * 90) / g.count),
          },
        }),
      );
    }

    for (const [userIndex, user] of users.entries()) {
      const share = (USERS[userIndex] as (typeof USERS)[number]).share;
      const unlocked = Math.floor(g.count * Math.max(0.05, share - gameIndex * 0.07));
      const stamps = Array.from({ length: unlocked }, (_, i) => ({
        userId: user.id,
        achievementId: (achievements[i] as (typeof achievements)[number]).id,
        unlockedAt: new Date(Date.now() - (gameIndex + 1) * (i + 1) * (userIndex + 1) * 7_200_000),
      }));
      await db.userAchievement.createMany({ data: stamps, skipDuplicates: true });

      const data = {
        unlockedCount: unlocked,
        totalCount: g.count,
        completion: (unlocked / g.count) * 100,
        lastUnlockedAt: stamps[0]?.unlockedAt ?? null,
      };
      await db.userGame.upsert({
        where: { userId_gameId: { userId: user.id, gameId: game.id } },
        update: data,
        create: { ...data, userId: user.id, gameId: game.id },
      });
    }
  }

  // Deux cartes terminées, dont une rare sur plusieurs plateformes.
  const demo = users[0] as (typeof users)[number];
  const marco = await db.user.findUniqueOrThrow({ where: { handle: 'marco' } });
  // Marco, présent dans beaucoup de parcours, a un compte Steam sans histoire.
  const open = { syncStatus: 'COMPLETED' as const, syncError: null, lastSyncedAt: new Date() };
  await db.syncRun.deleteMany({ where: { userId: marco.id, provider: 'STEAM' } });
  await db.linkedAccount.upsert({
    where: { provider_providerUserId: { provider: 'STEAM', providerUserId: 'marco-steam' } },
    update: open,
    create: {
      userId: marco.id,
      provider: 'STEAM',
      providerUserId: 'marco-steam',
      displayName: 'Marco',
      ...open,
    },
  });

  // Un profil Steam privé : le compte doit montrer comment l'ouvrir, et la fenêtre tout demander.
  const sam = await db.user.upsert({
    where: { handle: 'sam' },
    update: {},
    create: { handle: 'sam', displayName: 'Sam' },
  });
  const closed = {
    syncStatus: 'FAILED' as const,
    syncError: 'sync_steam_private',
    lastSyncedAt: new Date(),
  };
  // Un essai daté d'avance : le site ne le relance jamais, même longtemps après le seed.
  const later = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await db.syncRun.deleteMany({ where: { userId: sam.id, provider: 'STEAM' } });
  await db.syncRun.create({
    data: {
      userId: sam.id,
      provider: 'STEAM',
      startedAt: later,
      status: 'FAILED',
      error: 'sync_steam_private',
      finishedAt: later,
    },
  });
  await db.linkedAccount.upsert({
    where: { provider_providerUserId: { provider: 'STEAM', providerUserId: 'sam-steam' } },
    update: closed,
    create: {
      userId: sam.id,
      provider: 'STEAM',
      providerUserId: 'sam-steam',
      displayName: 'Sam',
      ...closed,
    },
  });

  // Un compte Steam au temps de jeu privé : le site doit le dire au joueur, où qu'il soit.
  const nora = await db.user.upsert({
    where: { handle: 'nora' },
    update: {},
    create: { handle: 'nora', displayName: 'Nora' },
  });
  const hiddenPlaytime = {
    syncStatus: 'COMPLETED' as const,
    lastSyncedAt: new Date(),
    playtimeHidden: true,
  };
  await db.linkedAccount.upsert({
    where: { provider_providerUserId: { provider: 'STEAM', providerUserId: 'nora-steam' } },
    update: hiddenPlaytime,
    create: {
      userId: nora.id,
      provider: 'STEAM',
      providerUserId: 'nora-steam',
      displayName: 'Nora',
      ...hiddenPlaytime,
    },
  });

  const perfect = await db.game.findUniqueOrThrow({ where: { slug: 'hades' } });
  const steps = await db.achievement.findMany({ where: { gameId: perfect.id } });
  await db.userAchievement.createMany({
    data: steps.map((a) => ({ userId: demo.id, achievementId: a.id, unlockedAt: new Date() })),
    skipDuplicates: true,
  });
  await db.userGame.update({
    where: { userId_gameId: { userId: demo.id, gameId: perfect.id } },
    data: { unlockedCount: steps.length, completion: 100, lastUnlockedAt: new Date() },
  });

  const platinumGame = await db.game.upsert({
    where: { platform_platformGameId: { platform: 'PSN', platformGameId: 'NPWR-DEMO' } },
    update: {},
    create: {
      platform: 'PSN',
      platformGameId: 'NPWR-DEMO',
      name: 'Astro Bot',
      slug: 'astro-bot',
      headerUrl: `${CDN}/620/header.jpg`,
      totalAchievements: 1,
      schemaSyncedAt: new Date(),
    },
  });
  const platinumTrophy = await db.achievement.upsert({
    where: {
      gameId_platformAchievementId: { gameId: platinumGame.id, platformAchievementId: '0' },
    },
    update: {},
    create: {
      gameId: platinumGame.id,
      platformAchievementId: '0',
      name: 'Platine de démonstration',
      trophyType: 'PLATINUM',
      points: 180,
    },
  });
  await db.userAchievement.createMany({
    data: [{ userId: demo.id, achievementId: platinumTrophy.id, unlockedAt: new Date() }],
    skipDuplicates: true,
  });
  const platinumProgress = {
    unlockedCount: 1,
    totalCount: 1,
    completion: 100,
    platinum: true,
    lastUnlockedAt: new Date(),
  };
  await db.userGame.upsert({
    where: { userId_gameId: { userId: demo.id, gameId: platinumGame.id } },
    update: platinumProgress,
    create: { ...platinumProgress, userId: demo.id, gameId: platinumGame.id },
  });

  // Astro Bot est commencé sur Steam : sa carte montre l'avancement vers le ×2.
  const astroSteam = await db.game.upsert({
    where: { platform_platformGameId: { platform: 'STEAM', platformGameId: 'demo-astro' } },
    update: {},
    create: {
      platform: 'STEAM',
      platformGameId: 'demo-astro',
      name: 'Astro Bot',
      slug: 'astro-bot-steam',
      headerUrl: platinumGame.headerUrl,
      totalAchievements: 10,
    },
  });
  const astroStarted = { unlockedCount: 4, totalCount: 10, completion: 40 };
  await db.userGame.upsert({
    where: { userId_gameId: { userId: demo.id, gameId: astroSteam.id } },
    update: astroStarted,
    create: { ...astroStarted, userId: demo.id, gameId: astroSteam.id },
  });

  // Hades existe aussi sur PlayStation : chaque plateforme finie ajoute un exemplaire.
  const hadesPsn = await db.game.upsert({
    where: { platform_platformGameId: { platform: 'PSN', platformGameId: 'NPWR-HADES' } },
    update: {},
    create: {
      platform: 'PSN',
      platformGameId: 'NPWR-HADES',
      name: 'Hades',
      slug: 'hades-psn',
      headerUrl: perfect.headerUrl,
      totalAchievements: 1,
    },
  });
  const hadesDouble = {
    unlockedCount: 1,
    totalCount: 1,
    completion: 100,
    lastUnlockedAt: new Date(),
  };
  await db.userGame.upsert({
    where: { userId_gameId: { userId: demo.id, gameId: hadesPsn.id } },
    update: hadesDouble,
    create: { ...hadesDouble, userId: demo.id, gameId: hadesPsn.id },
  });

  // Et sur Xbox : trois plateformes à 100 % donnent un ×3.
  const hadesXbox = await db.game.upsert({
    where: { platform_platformGameId: { platform: 'XBOX', platformGameId: 'XBOX-HADES' } },
    update: {},
    create: {
      platform: 'XBOX',
      platformGameId: 'XBOX-HADES',
      name: 'Hades',
      slug: 'hades-xbox',
      headerUrl: perfect.headerUrl,
      totalAchievements: 1,
    },
  });
  await db.userGame.upsert({
    where: { userId_gameId: { userId: demo.id, gameId: hadesXbox.id } },
    update: hadesDouble,
    create: { ...hadesDouble, userId: demo.id, gameId: hadesXbox.id },
  });

  // Des taux réels dans le jeu de données, jamais un niveau forcé :
  // Steam 0,6 %, PSN 0,4 %, Xbox 0,8 % donnent une moyenne de 0,6 % (Prismatique).
  await db.achievement.update({
    where: { gameId_platformAchievementId: { gameId: perfect.id, platformAchievementId: 'A48' } },
    data: { globalRarity: 0.6 },
  });
  for (const [game, globalRarity] of [
    [hadesPsn, 0.4],
    [hadesXbox, 0.8],
  ] as const) {
    const achievement = await db.achievement.upsert({
      where: { gameId_platformAchievementId: { gameId: game.id, platformAchievementId: '0' } },
      update: { globalRarity },
      create: { gameId: game.id, platformAchievementId: '0', name: 'Terminer Hades', globalRarity },
    });
    await db.userAchievement.createMany({
      data: [{ userId: demo.id, achievementId: achievement.id, unlockedAt: new Date() }],
      skipDuplicates: true,
    });
  }

  // Un jeu masqué par défaut, dans la bibliothèque de Léa.
  const adultGame = await db.game.upsert({
    where: { platform_platformGameId: { platform: 'STEAM', platformGameId: 'demo-adulte' } },
    update: {},
    create: {
      platform: 'STEAM',
      platformGameId: 'demo-adulte',
      name: 'Jeu réservé aux adultes',
      slug: 'jeu-reserve-aux-adultes',
      adultOnly: true,
      contentCheckedAt: new Date(),
    },
  });
  const lea = users[1] as (typeof users)[number];
  await db.userGame.upsert({
    where: { userId_gameId: { userId: lea.id, gameId: adultGame.id } },
    update: {},
    create: { userId: lea.id, gameId: adultGame.id },
  });

  // Assez de jeux pour remplir plusieurs pages de la liste.
  for (let i = 1; i <= 50; i++) {
    const name = `Jeu de démonstration ${i}`;
    await db.game.upsert({
      where: { platform_platformGameId: { platform: 'STEAM', platformGameId: `demo-${i}` } },
      update: {},
      create: {
        platform: 'STEAM',
        platformGameId: `demo-${i}`,
        name,
        slug: `jeu-de-demonstration-${i}`,
      },
    });
  }
  // Même regroupement et même calcul que le site, dès la fin du seed.
  const ungrouped = await db.game.findMany({
    where: { familyKey: null },
    select: { id: true, name: true },
  });
  for (const game of ungrouped) {
    await db.game.update({ where: { id: game.id }, data: { familyKey: familyKey(game.name) } });
  }
  await db.$executeRaw(sharedTierUpdate());
}

await main();
await db.$disconnect();
console.log('Données de démonstration créées.');
