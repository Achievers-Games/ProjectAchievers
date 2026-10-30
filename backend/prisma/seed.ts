import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo user
  const passwordHash = await bcrypt.hash('demo123', 12);

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@projectachievers.local' },
    update: {},
    create: {
      email: 'demo@projectachievers.local',
      username: 'DemoUser',
      passwordHash,
      displayName: 'Demo User',
      avatarUrl: null,
    },
  });

  console.log('✅ Created demo user:', demoUser.username);

  // Create some sample games
  const games = [
    {
      steamAppId: 730,
      name: 'Counter-Strike 2',
      slug: 'counter-strike-2',
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg',
      headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_600x900.jpg',
      platform: 'steam',
      totalAchievements: 177,
      releaseDate: new Date('2023-09-27'),
      genres: JSON.stringify(['Action', 'FPS', 'Competitive']),
      developers: JSON.stringify(['Valve']),
      publishers: JSON.stringify(['Valve']),
      description: 'Counter-Strike 2 is the next evolution of the world\'s number one team-based action game.',
    },
    {
      steamAppId: 1245620,
      name: 'Elden Ring',
      slug: 'elden-ring',
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg',
      headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_600x900.jpg',
      platform: 'steam',
      totalAchievements: 42,
      releaseDate: new Date('2022-02-25'),
      genres: JSON.stringify(['RPG', 'Open World', 'Action', 'Soulslike']),
      developers: JSON.stringify(['FromSoftware']),
      publishers: JSON.stringify(['Bandai Namco Entertainment']),
      description: 'THE NEW FANTASY ACTION RPG. Rise, Tarnished, and be guided by grace to brandish the power of the Elden Ring and become an Elden Lord in the Lands Between.',
    },
    {
      steamAppId: 1145360,
      name: 'Hades',
      slug: 'hades',
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg',
      headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900.jpg',
      platform: 'steam',
      totalAchievements: 48,
      releaseDate: new Date('2020-09-17'),
      genres: JSON.stringify(['Roguelike', 'Action', 'RPG']),
      developers: JSON.stringify(['Supergiant Games']),
      publishers: JSON.stringify(['Supergiant Games']),
      description: 'Defy the god of the dead as you hack and slash out of the Underworld in this rogue-like dungeon crawler from the creators of Bastion, Transistor, and Pyre.',
    },
    {
      steamAppId: 814380,
      name: 'Sekiro: Shadows Die Twice',
      slug: 'sekiro-shadows-die-twice',
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/814380/header.jpg',
      headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/814380/library_600x900.jpg',
      platform: 'steam',
      totalAchievements: 39,
      releaseDate: new Date('2019-03-22'),
      genres: JSON.stringify(['Action', 'Adventure', 'Soulslike']),
      developers: JSON.stringify(['FromSoftware']),
      publishers: JSON.stringify(['Activision', 'FromSoftware']),
      description: 'Carve your own clever path to vengeance in the award-winning adventure from developer FromSoftware, creators of Bloodborne and the Dark Souls series.',
    },
    {
      psnTitleId: 'CUSA00442_00',
      name: 'God of War (2018)',
      slug: 'god-of-war-2018',
      coverUrl: 'https://image.api.playstation.com/vulcan/ap/rnd/202009/0722/EN1a8JJj4xL6K7Qh0xJ8Yx4z.png',
      headerUrl: 'https://image.api.playstation.com/vulcan/ap/rnd/202009/0722/EN1a8JJj4xL6K7Qh0xJ8Yx4z.png',
      platform: 'psn',
      totalAchievements: 51,
      releaseDate: new Date('2018-04-20'),
      genres: JSON.stringify(['Action', 'Adventure', 'Mythology']),
      developers: JSON.stringify(['Santa Monica Studio']),
      publishers: JSON.stringify(['Sony Interactive Entertainment']),
      description: 'His vengeance against the Gods of Olympus years behind him, Kratos now lives as a man in the realm of Norse Gods and monsters.',
    },
    {
      steamAppId: 1091500,
      name: 'Cyberpunk 2077',
      slug: 'cyberpunk-2077',
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg',
      headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/library_600x900.jpg',
      platform: 'steam',
      totalAchievements: 44,
      releaseDate: new Date('2020-12-10'),
      genres: JSON.stringify(['RPG', 'Open World', 'Sci-Fi', 'Cyberpunk']),
      developers: JSON.stringify(['CD PROJEKT RED']),
      publishers: JSON.stringify(['CD PROJEKT RED']),
      description: 'Cyberpunk 2077 is an open-world, action-adventure story set in Night City, a megalopolis obsessed with power, glamour and body modification.',
    },
  ];

  for (const gameData of games) {
    const existing = await prisma.game.findFirst({
      where: {
        OR: [
          { steamAppId: gameData.steamAppId },
          { psnTitleId: gameData.psnTitleId },
        ],
      },
    });

    if (!existing) {
      await prisma.game.create({ data: gameData });
      console.log(`✅ Created game: ${gameData.name}`);
    }
  }

  // Create some sample achievements for CS2
  const cs2 = await prisma.game.findUnique({ where: { steamAppId: 730 } });
  if (cs2) {
    const achievements = [
      { platformAchievementId: 'WIN_100', name: 'Centurion', description: 'Win 100 matches.', trophyType: 'bronze', points: 15, hidden: false },
      { platformAchievementId: 'WIN_1000', name: 'Veteran', description: 'Win 1000 matches.', trophyType: 'silver', points: 30, hidden: false },
      { platformAchievementId: 'HEADSHOT_100', name: 'Headhunter', description: 'Get 100 headshot kills.', trophyType: 'bronze', points: 15, hidden: false },
      { platformAchievementId: 'BOMB_DEFUSE_50', name: 'Defusal Expert', description: 'Defuse 50 bombs.', trophyType: 'bronze', points: 15, hidden: false },
      { platformAchievementId: 'WIN_10000', name: 'Global Elite', description: 'Win 10000 matches.', trophyType: 'gold', points: 90, hidden: false, isPlatinum: false },
    ];

    for (const ach of achievements) {
      await prisma.achievement.upsert({
        where: { gameId_platformAchievementId: { gameId: cs2.id, platformAchievementId: ach.platformAchievementId } },
        update: {},
        create: { gameId: cs2.id, ...ach },
      });
    }
  }

  // Create sample user progress for demo user
  const cs2Game = await prisma.game.findUnique({ where: { steamAppId: 730 } });
  if (cs2Game) {
    await prisma.userGameProgress.upsert({
      where: { userId_gameId: { userId: demoUser.id, gameId: cs2Game.id } },
      update: {},
      create: {
        userId: demoUser.id,
        gameId: cs2Game.id,
        unlockedCount: 12,
        totalCount: 177,
        completionPercentage: 6.78,
        platinumUnlocked: false,
      },
    });

    // Add some user achievements
    const achievements = await prisma.achievement.findMany({ where: { gameId: cs2Game.id }, take: 3 });
    for (const ach of achievements) {
      await prisma.userAchievement.upsert({
        where: { userId_achievementId: { userId: demoUser.id, achievementId: ach.id } },
        update: {},
        create: {
          userId: demoUser.id,
          achievementId: ach.id,
          unlockedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
          rarityAtUnlock: Math.random() * 50,
          platform: 'steam',
        },
      });
    }
  }

  // Create some sample guides
  const cs2Achievements = await prisma.achievement.findMany({ where: { gameId: cs2Game?.id }, take: 2 });
  for (const ach of cs2Achievements) {
    await prisma.guide.upsert({
      where: { id: `guide-${ach.id}-demo` },
      update: {},
      create: {
        id: `guide-${ach.id}-demo`,
        achievementId: ach.id,
        authorId: demoUser.id,
        contentMd: `## Overview
This is a sample guide for **${ach.name}**.

## Step-by-Step Guide
1. Start a match in the appropriate game mode
2. Focus on the objective described in the achievement
3. Practice the required technique
4. Complete the requirement

## Tips & Strategies
- **Practice makes perfect**: Spend time in practice mode
- **Watch tutorials**: Learn from experienced players
- **Stay patient**: Some achievements take time

## Estimated Time
- **Main Objective**: ~2-5 hours
- **Full Completion**: ~10-20 hours

## Difficulty
**4/10** - Moderate difficulty

---
*This is a sample guide for demonstration purposes.*`,
        contentType: 'community',
        version: 1,
        status: 'published',
      },
    });
  }

  console.log('✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });