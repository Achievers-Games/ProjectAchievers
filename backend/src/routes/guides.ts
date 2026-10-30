import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, optionalAuth } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { guideCreateSchema, guideUpdateSchema, guideVoteSchema, aiGuideGenerateSchema, guidesQuerySchema } from '../utils/validation.js';

const router = Router();

// Get guides for an achievement
router.get('/', optionalAuth, async (req: any, res: Response) => {
  try {
    const data = guidesQuerySchema.parse(req.query);

    const guides = await prisma.guide.findMany({
      where: {
        achievementId: data.achievementId,
        status: 'published',
      },
      include: {
        author: {
          select: { id: true, username: true, avatarUrl: true },
        },
        _count: { select: { votes: true, comments: true } },
        votes: req.user ? { where: { userId: req.user!.id } } : false,
      },
      orderBy: [
        { upvotes: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const guidesWithVotes = guides.map(guide => {
      const userVote = guide.votes[0]?.voteType || null;
      return {
        ...guide,
        votes: undefined,
        upvotes: guide._count.votes - guide.downvotes,
        downvotes: guide.downvotes,
        userVote,
      };
    });

    return res.json(guidesWithVotes);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Get guides error:', error);
    res.status(500).json({ error: 'Failed to get guides' });
  }
});

// Create a new guide
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = guideCreateSchema.parse(req.body);

    // Verify achievement exists
    const achievement = await prisma.achievement.findUnique({
      where: { id: data.achievementId },
    });

    if (!achievement) {
      return res.status(404).json({ error: 'Achievement not found' });
    }

    const guide = await prisma.guide.create({
      data: {
        achievementId: data.achievementId,
        authorId: req.user!.id,
        contentMd: data.contentMd,
        contentType: data.contentType,
        videoUrl: data.videoUrl,
        images: JSON.stringify(data.images || []),
        aiGenerated: false,
        version: 1,
        status: 'published',
      },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    // Create activity feed entry
    const achievementWithGame = await prisma.achievement.findUnique({
      where: { id: data.achievementId },
      include: { game: true },
    });

    if (achievementWithGame) {
      await prisma.feedItem.create({
        data: {
          achievementId: data.achievementId,
          userId: req.user!.id,
          userId: req.user!.id,
          gameName: achievementWithGame.game.name,
          gameSlug: achievementWithGame.game.slug,
          gameCoverUrl: achievementWithGame.game.coverUrl,
          achievementName: achievementWithGame.name,
          achievementIconUrl: achievementWithGame.iconUrl,
          trophyType: achievementWithGame.trophyType,
          unlockedAt: new Date(),
          rarity: 0,
        },
      });
    }

    return res.status(201).json(guide);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Create guide error:', error);
    res.status(500).json({ error: 'Failed to create guide' });
  }
});

// Update a guide (creates new version)
router.put('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = guideUpdateSchema.parse(req.body);

    const existingGuide = await prisma.guide.findUnique({
      where: { id: data.guideId },
    });

    if (!existingGuide) {
      return res.status(404).json({ error: 'Guide not found' });
    }

    if (existingGuide.authorId !== req.user!.id) {
      return res.status(403).json({ error: 'You can only edit your own guides' });
    }

    const newVersion = existingGuide.version + 1;

    // Create new version
    const newGuide = await prisma.guide.create({
      data: {
        achievementId: existingGuide.achievementId,
        authorId: req.user!.id,
        contentMd: data.contentMd ?? existingGuide.contentMd,
        contentType: existingGuide.contentType,
        videoUrl: data.videoUrl ?? existingGuide.videoUrl,
        images: data.images ? JSON.stringify(data.images) : existingGuide.images,
        aiGenerated: existingGuide.aiGenerated,
        version: newVersion,
        parentGuideId: existingGuide.id,
        status: data.status ?? existingGuide.status,
        verified: false,
      },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    // Archive old version
    await prisma.guide.update({
      where: { id: data.guideId },
      data: { status: 'archived' },
    });

    return res.json(newGuide);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Update guide error:', error);
    res.status(500).json({ error: 'Failed to update guide' });
  }
});

// Delete a guide
router.delete('/:guideId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const guideId = req.params.guideId;

    const guide = await prisma.guide.findUnique({ where: { id: guideId } });
    if (!guide) return res.status(404).json({ error: 'Guide not found' });
    if (guide.authorId !== req.user!.id) return res.status(403).json({ error: 'Not authorized' });

    await prisma.guide.delete({ where: { id: guideId } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete guide error:', error);
    res.status(500).json({ error: 'Failed to delete guide' });
  }
});

// Vote on a guide
router.post('/vote', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = guideVoteSchema.parse(req.body);

    const guide = await prisma.guide.findUnique({ where: { id: data.guideId } });
    if (!guide) return res.status(404).json({ error: 'Guide not found' });

    // Upsert vote
    await prisma.vote.upsert({
      where: {
        guideId_userId: {
        userId: req.user!.id,
            userId: req.user!.id,
          }
      },
      update: { voteType: data.voteType },
      create: {
        userId: req.user!.id,
        userId: req.user!.id,
        voteType: data.voteType,
      },
    });

    // Get updated counts
    const [upvotes, downvotes] = await Promise.all([
      prisma.vote.count({ where: { userId: req.user!.id, voteType: 'up' } }),
      prisma.vote.count({ where: { userId: req.user!.id, voteType: 'down' } }),
    ]);

    // Check user's vote
    const userVote = await prisma.vote.findUnique({
      where: {
        guideId: data.guideId,
        userId: req.user!.id,
      },
      select: { voteType: true },
    });
    return res.json({ upvotes, downvotes, userVote: userVote?.voteType || null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Vote guide error:', error);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// Generate AI guide
router.post('/ai-generate', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = aiGuideGenerateSchema.parse(req.body);

    // In a real implementation, this would call an AI service
    // For now, return a template response
    const templateGuide = `## Overview
This is an AI-generated guide placeholder. In the full implementation, this would be generated by an AI model (local LLM like Phi-3-mini via llama.cpp, or cloud API).

## Step-by-Step Guide
1. **Step 1**: Placeholder step - replace with actual requirements
2. **Step 2**: Continue with specific game mechanics
3. **Step 3**: Complete the final requirement

## Tips & Strategies
- **Missables**: Watch for any missable content
- **Difficulty**: Adjust based on your playstyle
- **Co-op**: Check if multiplayer is required

## Estimated Time
- **Main Story**: ~X hours
- **100% Completion**: ~Y hours

## Difficulty
**5/10** - Moderate difficulty, requires some skill/knowledge

---
*This guide was generated by AI. Community verification recommended.*`;

    const guide = await prisma.guide.create({
      data: {
        achievementId: data.achievementId,
        authorId: req.user!.id,
        contentMd: templateGuide,
        contentType: 'ai',
        aiGenerated: true,
        aiModel: 'local-llm',
        version: 1,
        status: 'published',
      },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    return res.status(201).json(guide);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('AI guide error:', error);
    res.status(500).json({ error: 'Failed to generate AI guide' });
  }
});

export default router;