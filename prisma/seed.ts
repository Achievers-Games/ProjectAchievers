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
        platinum: unlocked === g.count,
        lastUnlockedAt: stamps[0]?.unlockedAt ?? null,
      };
      await db.userGame.upsert({
        where: { userId_gameId: { userId: user.id, gameId: game.id } },
        update: data,
        create: { ...data, userId: user.id, gameId: game.id },
      });
    }
  }
}

await main();
await db.$disconnect();
console.log('Données de démonstration créées.');
