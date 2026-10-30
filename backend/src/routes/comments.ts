import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, optionalAuth } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { commentCreateSchema, commentUpdateSchema, commentReactionSchema, commentsQuerySchema } from '../utils/validation.js';

const router = Router();

// Get comments for an achievement (threaded)
router.get('/', optionalAuth, async (req: any, res: Response) => {
  try {
    const data = commentsQuerySchema.parse(req.query);

    // Get top-level comments
    const comments = await prisma.comment.findMany({
      where: {
        achievementId: data.achievementId,
        parentId: null,
        isDeleted: false,
      },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        reactions: true,
        _count: { select: { replies: { where: { isDeleted: false } } } },
        userReaction: req.user ? { where: { userId: req.user!.id } } : false,
      },
      orderBy: { createdAt: 'desc' },
      take: data.limit,
      skip: data.offset,
    });

    // Get replies for each comment (recursive, max depth 3)
    const commentsWithReplies = await Promise.all(comments.map(async (comment) => {
      return buildCommentTree(comment, req.user?.id, 0);
    }));

    return res.json(commentsWithReplies);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

async function buildCommentTree(comment: any, userId: string | undefined, depth: number) {
  const reactions = {
    helpful: comment.reactions.filter((r: any) => r.type === 'helpful').length,
    funny: comment.reactions.filter((r: any) => r.type === 'funny').length,
    thanks: comment.reactions.filter((r: any) => r.type === 'thanks').length,
    heart: comment.reactions.filter((r: any) => r.type === 'heart').length,
  };

  const userReaction = comment.userReaction?.[0]?.type || null;

  const result: any = {
    id: comment.id,
    achievementId: comment.achievementId,
    userId: comment.userId,
    username: comment.user.username,
    avatarUrl: comment.user.avatarUrl,
    contentMd: comment.isDeleted ? '[Deleted]' : comment.contentMd,
    parentId: comment.parentId,
    depth: comment.depth,
    reactions,
    userReaction,
    replyCount: comment._count.replies,
    isDeleted: comment.isDeleted,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    replies: null,
  };

  if (depth < 3 && !comment.isDeleted) {
    const replies = await prisma.comment.findMany({
      where: { parentId: comment.id, isDeleted: false },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        reactions: true,
        _count: { select: { replies: { where: { isDeleted: false } } } },
        userReaction: userId ? { where: { userId } } : false,
      },
      orderBy: { createdAt: 'asc' },
    });

    result.replies = await Promise.all(replies.map(r => buildCommentTree(r, userId, depth + 1)));
  }

  return result;
}

// Create a new comment
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = commentCreateSchema.parse(req.body);

    // Validate parent if provided
    let depth = 0;
    if (data.parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: data.parentId } });
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
      if (parent.depth >= 3) return res.status(400).json({ error: 'Maximum reply depth reached' });
      depth = parent.depth + 1;
    }

    const comment = await prisma.comment.create({
      data: {
        achievementId: data.achievementId,
        userId: req.user!.id,
        contentMd: data.contentMd,
        parentId: data.parentId,
        depth,
      },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    // Create activity feed entry if top-level comment
    if (!data.parentId) {
      const achievement = await prisma.achievement.findUnique({
        where: { id: data.achievementId },
        include: { game: true },
      });

      if (achievement) {
        await prisma.feedItem.create({
          data: {
            achievementId: data.achievementId,
            userId: req.user!.id,
            gameName: achievement.game.name,
            gameSlug: achievement.game.slug,
            gameCoverUrl: achievement.game.coverUrl,
            achievementName: achievement.name,
            achievementIconUrl: achievement.iconUrl,
            trophyType: achievement.trophyType,
            unlockedAt: new Date(),
            rarity: 0,
          },
        });
      }
    }

    return res.status(201).json({
      ...comment,
      reactions: { helpful: 0, funny: 0, thanks: 0, heart: 0 },
      userReaction: null,
      replyCount: 0,
      isDeleted: false,
      replies: null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Update a comment
router.put('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = commentUpdateSchema.parse(req.body);

    const comment = await prisma.comment.findUnique({ where: { id: data.commentId } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.user!.id) return res.status(403).json({ error: 'Not authorized' });

    const updated = await prisma.comment.update({
      where: { id: data.commentId },
      data: { contentMd: data.contentMd, updatedAt: new Date() },
    });

    return res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Update comment error:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment (soft delete)
router.delete('/:commentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const commentId = req.params.commentId;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.user!.id) return res.status(403).json({ error: 'Not authorized' });

    await prisma.comment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// React to a comment
router.post('/reaction', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = commentReactionSchema.parse(req.body);

    const validReactions = ['helpful', 'funny', 'thanks', 'heart'];
    if (!validReactions.includes(data.reactionType)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    const comment = await prisma.comment.findUnique({
      where: { id: data.commentId, isDeleted: false },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Toggle reaction
    const existing = await prisma.commentReaction.findUnique({
      where: { commentId_userId: { commentId: data.commentId, userId: req.user!.id } },
    });

    if (existing) {
      if (existing.type === data.reactionType) {
        // Remove reaction (toggle off)
        await prisma.commentReaction.delete({
          where: { id: existing.id },
        });
      } else {
        // Change reaction
        await prisma.commentReaction.update({
          where: { id: existing.id },
          data: { type: data.reactionType },
        });
      }
    } else {
      // Add new reaction
      await prisma.commentReaction.create({
        data: {
          commentId: data.commentId,
          userId: req.user!.id,
          type: data.reactionType,
        },
      });
    }

    // Return updated counts
    const reactions = await prisma.commentReaction.groupBy({
      by: ['type'],
      where: { commentId: data.commentId },
      _count: { type: true },
    });

    const counts = { helpful: 0, funny: 0, thanks: 0, heart: 0 };
    for (const r of reactions) {
      counts[r.type as keyof typeof counts] = r._count.type;
    }

    return res.json({ ...counts, userReaction: data.reactionType });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Comment reaction error:', error);
    res.status(500).json({ error: 'Failed to react' });
  }
});

export default router;