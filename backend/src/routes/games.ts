import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, optionalAuth } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { gamesQuerySchema, gameDetailParamsSchema, searchGamesSchema, userGameProgressParamsSchema } from '../utils/validation.js';

const router = Router();

// List games with filters
router.get('/', optionalAuth, async (req: any, res: Response) => {
  try {
    const data = gamesQuerySchema.parse(req.query);

    const where: any = {};
    if (data.platform) where.platform = data.platform;
    if (data.genre) where.genres = { contains: data.genre };
    if (data.search) {
      where.OR = [
        { name: { contains: data.search, mode: 'insensitive' } },
        { slug: { contains: data.search, mode: 'insensitive' } },
      ];
    }

    const [games, total] = await Promise.all<[any[], number]>([
      prisma.game.findMany({
        where,
        orderBy: { name: 'asc' },
        take: data.limit,
        skip: data.offset,
        include: {
          _count: { select: { achievements: true } },
        },
      }),
      prisma.game.count({ where }),
    ]);

    // Add user progress if authenticated
    let userProgressMap = new Map<string, any>();
    if (req.user) {
      const progress = await prisma.userGameProgress.findMany({
        where: { userId: req.user!.id, gameId: { in: games.map(g => g.id) } },
      });
      userProgressMap = new Map(progress.map(p => [p.gameId, p]));
    }

    const gamesWithProgress = games.map(game => {
      const progress = userProgressMap.get(game.id);
      return {
        ...game,
        totalAchievements: game._count.achievements,
        userProgress: progress ? {
          unlockedCount: progress.unlockedCount,
          totalCount: progress.totalCount,
          completionPercentage: progress.completionPercentage,
          platinumUnlocked: progress.platinumUnlocked,
          lastUnlockedAt: progress.lastUnlockedAt,
        } : null,
      };
    });

    return res.json({ games: gamesWithProgress, total, limit: data.limit, offset: data.offset });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('List games error:', error);
    res.status(500).json({ error: 'Failed to list games' });
  }
});

// Search games
router.get('/search', async (req: any, res: Response) => {
  try {
    const data = searchGamesSchema.parse(req.query);

    const games = await prisma.game.findMany({
      where: {
        OR: [
          { name: { contains: data.query, mode: 'insensitive' } },
          { slug: { contains: data.query, mode: 'insensitive' } },
        ],
      },
      orderBy: [
        { name: { _count: 'desc' } },
        { name: 'asc' },
      ],
      take: data.limit,
      select: {
        id: true,
        name: true,
        slug: true,
        coverUrl: true,
        platform: true,
        totalAchievements: true,
      },
    });

    return res.json(games);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Search games error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get game detail with achievements
router.get('/:gameId', optionalAuth, async (req: any, res: Response) => {
  try {
    const data = gameDetailParamsSchema.parse(req.params);

    const game = await prisma.game.findUnique({
      where: { id: data.gameId },
      include: {
        achievements: {
          orderBy: [
            { trophyType: 'desc' },
            { name: 'asc' },
          ],
        },
        _count: { select: { achievements: true } },
      },
    });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Get user progress if authenticated
    let userProgress = null;
    let achievementProgress = new Map<string, any>();

    if (req.user) {
      const progress = await prisma.userGameProgress.findUnique({
        where: { userId_gameId: { userId: req.user!.id, gameId: data.gameId } },
      });
      userProgress = progress;

      const userAchievements = await prisma.userAchievement.findMany({
        where: {
          userId: req.user!.id,
          achievement: { gameId: data.gameId },
        },
        select: { achievementId: true, unlockedAt: true, rarityAtUnlock: true },
      });
      achievementProgress = new Map(userAchievements.map(a => [a.achievementId, a]));
    }

    const achievementsWithProgress = game.achievements.map(ach => {
      const userAch = achievementProgress.get(ach.id);
      return {
        ...ach,
        unlocked: !!userAch,
        unlockedAt: userAch?.unlockedAt,
        rarityAtUnlock: userAch?.rarityAtUnlock,
      };
    });

    const total = game._count.achievements;
    const unlocked = req.user ? Array.from(achievementProgress.values()).length : 0;
    const platinumUnlocked = req.user
      ? game.achievements.some(a => a.isPlatinum && achievementProgress.has(a.id))
      : false;

    return res.json({
      ...game,
      totalAchievements: total,
      userProgress: userProgress ? {
        unlockedCount: userProgress.unlockedCount,
        totalCount: userProgress.totalCount,
        completionPercentage: userProgress.completionPercentage,
        platinumUnlocked: userProgress.platinumUnlocked,
        lastUnlockedAt: userProgress.lastUnlockedAt,
      } : null,
      achievements: achievementsWithProgress,
    });
  } catch (error) {
    console.error('Game detail error:', error);
    res.status(500).json({ error: 'Failed to get game detail' });
  }
});

// Search games (alias)
router.get('/search/:query', async (req: any, res: Response) => {
  try {
    const { query, limit = 20 } = req.params;
    const lim = parseInt(limit as string) || 20;

    const games = await prisma.game.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: Math.min(Math.max(parseInt(limit as string) || 20, 1), 50),
      select: {
        id: true,
        name: true,
        slug: true,
        coverUrl: true,
        platform: true,
        totalAchievements: true,
      },
    });

    return res.json(games);
  } catch (error) {
    console.error('Search games error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get user progress for a game
router.get('/:gameId/progress', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const data = userGameProgressParamsSchema.parse(req.params);

    const progress = await prisma.userGameProgress.findUnique({
      where: { userId_gameId: { userId: req.user!.id, gameId: data.gameId } },
    });

    if (!progress) {
      return res.json({
        unlockedCount: 0,
        totalCount: 0,
        completionPercentage: 0,
        platinumUnlocked: false,
        lastUnlockedAt: null,
      });
    }

    return res.json({
      unlockedCount: progress.unlockedCount,
      totalCount: progress.totalCount,
      completionPercentage: progress.completionPercentage,
      platinumUnlocked: progress.platinumUnlocked,
      lastUnlockedAt: progress.lastUnlockedAt,
    });
  } catch (error) {
    console.error('User game progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

export default router;