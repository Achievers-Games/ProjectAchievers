import { Router, Response } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { communityFeedQuerySchema, leaderboardQuerySchema } from '../utils/validation.js';

const router = Router();

// Get community activity feed
router.get('/feed', optionalAuth, async (req: any, res: Response) => {
  try {
    const data = communityFeedQuerySchema.parse(req.query);

    const feed = await prisma.feedItem.findMany({
      orderBy: { createdAt: 'desc' },
      take: data.limit,
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        achievement: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
            trophyType: true,
            game: { select: { name: true, slug: true, coverUrl: true } },
          },
        },
      },
    });

    return res.json(feed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Community feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

// Get leaderboard
router.get('/leaderboard', optionalAuth, async (req: any, res: Response) => {
  try {
    const data = leaderboardQuerySchema.parse(req.query);

    const leaderboard = await prisma.leaderboardEntry.findMany({
      where: { period: data.period as any },
      orderBy: [{ rank: 'asc' }],
      take: data.limit,
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    return res.json(leaderboard);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// Get user's rank
router.get('/rank', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const period = (req.query.period as string) || 'all';
    const entry = await prisma.leaderboardEntry.findUnique({
      where: { userId_period: { userId: payload.userId, period } },
      include: { user: { select: { id: true, username: true, avatarUrl: true } } },
    });

    if (!entry) {
      // Calculate on the fly if no entry exists
      const unlocked = await prisma.userAchievement.count({ where: { userId: payload.userId } });
      const platinums = await prisma.userAchievement.count({
        where: { userId: payload.userId, achievement: { isPlatinum: true } },
      });
      const points = await calculatePoints(payload.userId);

      return res.json({ unlocked, platinums, points, rank: null });
    }

    return res.json(entry);
  } catch (error) {
    console.error('Get rank error:', error);
    res.status(500).json({ error: 'Failed to get rank' });
  }
});

async function calculatePoints(userId: string): Promise<number> {
  const achievements = await prisma.userAchievement.findMany({
    where: { userId },
    include: { achievement: true },
  });

  let points = 0;
  for (const ua of achievements) {
    if (ua.achievement.isPlatinum) points += 180;
    else if (ua.achievement.trophyType === 'gold') points += 90;
    else if (ua.achievement.trophyType === 'silver') points += 30;
    else if (ua.achievement.trophyType === 'bronze') points += 15;
    else points += 10; // standard achievement
  }
  return points;
}

export default router;