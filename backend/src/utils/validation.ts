import { z } from 'zod';

// Auth schemas
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(30, 'Username too long').regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password too long'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
});

// Steam schemas
export const steamOAuthUrlSchema = z.object({
  state: z.string().min(1, 'State required'),
});

export const steamOAuthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code required'),
  state: z.string().min(1, 'State required'),
});

export const steamVanityResolveSchema = z.object({
  profile: z.string().min(1, 'Profile identifier required'),
});

export const steamSyncSchema = z.object({
  force: z.boolean().optional(),
});

// Discord schemas
export const discordOAuthUrlSchema = z.object({
  state: z.string().min(1, 'State required'),
});

export const discordOAuthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code required'),
  state: z.string().min(1, 'State required'),
});

// PSN schemas
export const psnLinkSchema = z.object({
  npsso: z.string().min(1, 'NPSSO token required'),
});

export const psnImportSchema = z.object({
  username: z.string().min(1, 'PSNProfiles username required'),
});

export const psnManualTrophySchema = z.object({
  gameName: z.string().min(1, 'Game name required'),
  trophyName: z.string().min(1, 'Trophy name required'),
  trophyType: z.enum(['platinum', 'gold', 'silver', 'bronze']),
  description: z.string().min(1, 'Description required'),
  earned: z.boolean(),
  earnedDate: z.string().datetime().nullable().optional(),
});

// Games schemas
export const gamesQuerySchema = z.object({
  platform: z.enum(['steam', 'psn']).optional(),
  genre: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const gameDetailParamsSchema = z.object({
  gameId: z.string().cuid('Invalid game ID'),
});

export const searchGamesSchema = z.object({
  query: z.string().min(1, 'Search query required'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const userGameProgressParamsSchema = z.object({
  gameId: z.string().cuid('Invalid game ID'),
});

// Guides schemas
export const guideCreateSchema = z.object({
  achievementId: z.string().cuid('Invalid achievement ID'),
  contentMd: z.string().min(10, 'Guide content too short').max(50000, 'Guide content too long'),
  contentType: z.enum(['community']),
  videoUrl: z.string().url().optional().nullable(),
  images: z.array(z.string().url()).optional().default([]),
});

export const guideUpdateSchema = z.object({
  guideId: z.string().cuid('Invalid guide ID'),
  contentMd: z.string().min(10, 'Guide content too short').max(50000, 'Guide content too long').optional(),
  videoUrl: z.string().url().optional().nullable(),
  images: z.array(z.string().url()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

export const guideVoteSchema = z.object({
  guideId: z.string().cuid('Invalid guide ID'),
  voteType: z.enum(['up', 'down']),
});

export const aiGuideGenerateSchema = z.object({
  achievementId: z.string().cuid('Invalid achievement ID'),
  gameName: z.string().min(1, 'Game name required'),
  achievementName: z.string().min(1, 'Achievement name required'),
  achievementDescription: z.string().min(1, 'Achievement description required'),
  trophyType: z.string().optional(),
  knownRequirements: z.string().optional(),
});

export const guidesQuerySchema = z.object({
  achievementId: z.string().cuid('Invalid achievement ID'),
});

// Comments schemas
export const commentCreateSchema = z.object({
  achievementId: z.string().cuid('Invalid achievement ID'),
  contentMd: z.string().min(1, 'Comment cannot be empty').max(10000, 'Comment too long'),
  parentId: z.string().cuid('Invalid parent comment ID').optional().nullable(),
});

export const commentUpdateSchema = z.object({
  commentId: z.string().cuid('Invalid comment ID'),
  contentMd: z.string().min(1, 'Comment cannot be empty').max(10000, 'Comment too long'),
});

export const commentReactionSchema = z.object({
  commentId: z.string().cuid('Invalid comment ID'),
  reactionType: z.enum(['helpful', 'funny', 'thanks', 'heart']),
});

export const commentsQuerySchema = z.object({
  achievementId: z.string().cuid('Invalid achievement ID'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Sync schemas
export const syncAllSchema = z.object({});

export const syncStatusQuerySchema = z.object({});

export const syncHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const forceSyncGameSchema = z.object({
  gameId: z.string().cuid('Invalid game ID'),
});

// Community schemas
export const communityFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sessionRevokeSchema = z.object({
  sessionId: z.string().min(1, 'Session ID required'),
});

export const revokeOtherSessionsSchema = z.object({});

export const getSessionsSchema = z.object({});

// Export all schemas for easy importing
export const schemas = {
  register: registerSchema,
  login: loginSchema,
  refreshToken: refreshTokenSchema,
  steamOAuthUrl: steamOAuthUrlSchema,
  steamOAuthCallback: steamOAuthCallbackSchema,
  steamVanityResolve: steamVanityResolveSchema,
  steamSync: steamSyncSchema,
  discordOAuthUrl: discordOAuthUrlSchema,
  discordOAuthCallback: discordOAuthCallbackSchema,
  psnLink: psnLinkSchema,
  psnImport: psnImportSchema,
  psnManualTrophy: psnManualTrophySchema,
  gamesQuery: gamesQuerySchema,
  gameDetailParams: gameDetailParamsSchema,
  searchGames: searchGamesSchema,
  userGameProgressParams: userGameProgressParamsSchema,
  guideCreate: guideCreateSchema,
  guideUpdate: guideUpdateSchema,
  guideVote: guideVoteSchema,
  aiGuideGenerate: aiGuideGenerateSchema,
  guidesQuery: guidesQuerySchema,
  commentCreate: commentCreateSchema,
  commentUpdate: commentUpdateSchema,
  commentReaction: commentReactionSchema,
  commentsQuery: commentsQuerySchema,
  syncAll: syncAllSchema,
  syncStatusQuery: syncStatusQuerySchema,
  syncHistoryQuery: syncHistoryQuerySchema,
  forceSyncGame: forceSyncGameSchema,
  communityFeedQuery: communityFeedQuerySchema,
  leaderboardQuery: leaderboardQuerySchema,
  sessionRevoke: sessionRevokeSchema,
  revokeOtherSessions: revokeOtherSessionsSchema,
  getSessions: getSessionsSchema,
};