import 'dotenv/config';
import { createPrismaClient } from '../src/lib/server/prisma';

const db = createPrismaClient();

const SLUG = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, '');

async function main() {
  const game = await db.game.upsert({
    where: { platform_platformGameId: { platform: 'STEAM', platformGameId: '418220' } },
    update: {},
    create: {
      platform: 'STEAM',
      platformGameId: '418220',
      name: 'Minecraft',
      slug: SLUG('Minecraft'),
      totalAchievements: 6,
    },
  });
  console.log('Jeu créé :', game.id);

  const achs = [
    { id: 'MC_MonsterHunter', name: 'Chasseur de monstres' },
    { id: 'MC_AdventuringTime', name: 'Adventuring Time' },
    { id: 'MC_SniperDuel', name: 'Duel de snipeurs' },
    { id: 'MC_Overkill', name: 'Surpuissance' },
    { id: 'MC_HowDidWeGetHere', name: 'Comment en sommes-nous arrivés là ?' },
  ];

  for (const a of achs) {
    const ach = await db.achievement.upsert({
      where: { gameId_platformAchievementId: { gameId: game.id, platformAchievementId: a.id } },
      update: {},
      create: {
        gameId: game.id,
        platformAchievementId: a.id,
        name: a.name,
        description: `Obtenir le succès "${a.name}" dans Minecraft.`,
        trophyType: 'ACHIEVEMENT',
        hidden: false,
        globalRarity: 50,
      },
    });
    console.log('Succès créé :', ach.platformAchievementId);
  }

  console.log('Terminé :', achs.length, 'succès créés pour Minecraft.');
}

await main();
await db.$disconnect();
