// Données de démonstration, pour le développement uniquement.
import { PrismaClient, type TrophyType } from '@prisma/client';

const db = new PrismaClient();

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

  // Une carte de chaque rareté.
  const demo = users[0] as (typeof users)[number];
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
}

await main();
await db.$disconnect();
console.log('Données de démonstration créées.');
