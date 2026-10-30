/**
 * Backend API Client
 *
 * Replaces Tauri commands with fetch() calls to the backend API.
 * Works in both browser (development) and Tauri (production) modes.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Types
export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface LinkedAccount {
  id: string;
  provider: string;
  providerUserId: string;
  providerUsername?: string;
  avatarUrl?: string;
  lastSyncedAt?: number;
  syncStatus: string;
  syncError?: string;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  user?: User;
  linkedAccounts: LinkedAccount[];
}

export interface Game {
  id: string;
  steamAppId?: number;
  psnTitleId?: string;
  name: string;
  slug: string;
  coverUrl?: string;
  headerUrl?: string;
  platform: string;
  totalAchievements: number;
  userProgress?: UserGameProgress | null;
}

export interface UserGameProgress {
  unlockedCount: number;
  totalCount: number;
  completionPercentage: number;
  platinumUnlocked: boolean;
  lastUnlockedAt?: number;
}

export interface Achievement {
  id: string;
  gameId: string;
  platformAchievementId: string;
  name: string;
  description: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  hidden: boolean;
  trophyType?: string;
  globalRarity?: number;
  points: number;
  isPlatinum: boolean;
}

export interface GameDetail extends Game {
  steamAppId?: number;
  psnTitleId?: string;
  platinumAchievementId?: string;
  releaseDate?: number;
  genres: string[];
  developers: string[];
  publishers: string[];
  description?: string;
  achievements: AchievementWithProgress[];
}

export interface AchievementWithProgress extends Achievement {
  unlocked: boolean;
  unlockedAt?: number;
  rarityAtUnlock?: number;
}

export interface Guide {
  id: string;
  achievementId: string;
  authorId: string;
  authorUsername: string;
  authorAvatar?: string;
  contentMd: string;
  contentType: string;
  videoUrl?: string;
  images: string[];
  aiGenerated: boolean;
  aiModel?: string;
  version: number;
  parentGuideId?: string;
  status: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: number;
  upvotes: number;
  downvotes: number;
  userVote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Comment {
  id: string;
  achievementId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  contentMd: string;
  parentId?: string;
  depth: number;
  reactions: CommentReactions;
  userReaction?: string;
  replyCount: number;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
  replies?: Comment[];
}

export interface CommentReactions {
  helpful: number;
  funny: number;
  thanks: number;
  heart: number;
}

export interface SyncResult {
  gamesSynced: number;
  achievementsSynced: number;
  trophiesSynced?: number;
  errors: string[];
}

export interface SyncStatus {
  platform: string;
  lastSyncedAt?: number;
  syncStatus: string;
  syncError?: string;
  gamesSynced: number;
  achievementsSynced: number;
}

export interface FeedItem {
  id: string;
  achievementId: string;
  username: string;
  avatarUrl?: string;
  gameName: string;
  gameSlug: string;
  gameCoverUrl?: string;
  achievementName: string;
  achievementIconUrl?: string;
  trophyType?: string;
  unlockedAt: number;
  rarity?: number;
}

export interface LeaderboardEntry {
  username: string;
  avatarUrl?: string;
  unlocked: number;
  platinums: number;
  points: number;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  sessionId: string;
}

// ============================================================================
// API Client
// ============================================================================

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add auth token from cookie (handled automatically by browser)
  // Or from Authorization header if provided

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Important for cookies
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `HTTP ${response.status}`,
      response.status,
      errorData
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// ============================================================================
// Auth API
// ============================================================================

export const authApi = {
  register: (data: { email: string; username: string; password: string }) =>
    fetchApi<{ user: User; accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    fetchApi<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    fetchApi<void>('/auth/logout', { method: 'POST' }),

  refresh: (refreshToken: string) =>
    fetchApi<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  me: () =>
    fetchApi<{ user: User; linkedAccounts: LinkedAccount[] }>('/auth/me'),

  status: () =>
    fetchApi<AuthStatus>('/auth/status'),

  unlinkAccount: (accountId: string) =>
    fetchApi<void>(`/auth/accounts/${accountId}`, { method: 'DELETE' }),

  verify: () =>
    fetchApi<{ valid: boolean; user: User }>('/auth/verify', { method: 'POST' }),
};

// ============================================================================
// Steam API
// ============================================================================

export const steamApi = {
  oauthUrl: (state: string) =>
    fetchApi<{ url: string }>(`/steam/oauth/url?state=${encodeURIComponent(state)}`),

  resolveVanity: (profile: string) =>
    fetchApi<any>(`/steam/resolve/${encodeURIComponent(profile)}`),

  sync: () =>
    fetchApi<{ steam: SyncResult; psn: SyncResult; totalGames: number; totalAchievements: number }>('/steam/sync', {
      method: 'POST',
    }),

  games: () =>
    fetchApi<any[]>('/steam/games'),

  schema: (appId: number) =>
    fetchApi<any>(`/steam/schema/${appId}`),

  achievements: (appId: number) =>
    fetchApi<any[]>(`/steam/achievements/${appId}`),

  globalPercentages: (appId: number) =>
    fetchApi<any[]>(`/steam/global/${appId}`),

  resolve: (profile: string) =>
    fetchApi<any>(`/steam/resolve/${encodeURIComponent(profile)}`),
};

// ============================================================================
// Discord API
// ============================================================================

export const discordApi = {
  oauthUrl: (state: string) =>
    fetchApi<{ url: string; state: string }>(`/discord/oauth/url?state=${encodeURIComponent(state)}`),

  user: () =>
    fetchApi<{ user: any; guilds: any[] }>('/discord/user'),

  refresh: () =>
    fetchApi<{ success: boolean }>('/discord/refresh', { method: 'POST' }),

  revoke: () =>
    fetchApi<{ success: boolean }>('/discord/revoke', { method: 'POST' }),
};

// ============================================================================
// PSN API
// ============================================================================

export const psnApi = {
  link: (npsso: string) =>
    fetchApi<{ success: boolean; psnId: string }>('/psn/link', {
      method: 'POST',
      body: JSON.stringify({ npsso }),
    }),

  import: (username: string) =>
    fetchApi<{ success: boolean; gamesSynced: number; trophiesSynced: number; errors: string[] }>('/psn/import', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  manualTrophy: (data: {
    gameName: string;
    trophyName: string;
    trophyType: 'platinum' | 'gold' | 'silver' | 'bronze';
    description: string;
    earned: boolean;
    earnedDate?: string;
  }) =>
    fetchApi<{ success: boolean; achievementId: string }>('/psn/trophy', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  games: () =>
    fetchApi<any[]>('/psn/games'),

  sync: () =>
    fetchApi<{ success: boolean; gamesSynced: number; trophiesSynced: number; errors: string[] }>('/psn/sync', {
      method: 'POST',
    }),
};

// ============================================================================
// Games API
// ============================================================================

export const gamesApi = {
  list: (params?: {
    platform?: 'steam' | 'psn';
    genre?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.append(key, String(value));
      });
    }
    return fetchApi<{ games: Game[]; total: number; limit: number; offset: number }>(
      `/games?${searchParams.toString()}`
    );
  },

  search: (query: string, limit = 20) =>
    fetchApi<Game[]>(`/games/search/${encodeURIComponent(query)}?limit=${limit}`),

  detail: (gameId: string) =>
    fetchApi<GameDetail>(`/games/${gameId}`),

  searchShort: (query: string, limit = 20) =>
    fetchApi<Game[]>(`/games/search/${encodeURIComponent(query)}?limit=${limit}`),

  progress: (gameId: string) =>
    fetchApi<UserGameProgress>(`/games/${gameId}/progress`),
};

// ============================================================================
// Guides API
// ============================================================================

export const guidesApi = {
  list: (achievementId: string) =>
    fetchApi<any[]>(`/guides?achievementId=${achievementId}`),

  create: (data: {
    achievementId: string;
    contentMd: string;
    contentType: 'community';
    videoUrl?: string;
    images?: string[];
  }) =>
    fetchApi<any>('/guides', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (data: {
    guideId: string;
    contentMd?: string;
    videoUrl?: string;
    images?: string[];
    status?: 'draft' | 'published' | 'archived';
  }) =>
    fetchApi<any>('/guides', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (guideId: string) =>
    fetchApi<void>(`/guides/${guideId}`, { method: 'DELETE' }),

  vote: (guideId: string, voteType: 'up' | 'down') =>
    fetchApi<{ upvotes: number; downvotes: number; userVote: string | null }>('/guides/vote', {
      method: 'POST',
      body: JSON.stringify({ guideId, voteType }),
    }),

  aiGenerate: (data: {
    achievementId: string;
    gameName: string;
    achievementName: string;
    achievementDescription: string;
    trophyType?: string;
    knownRequirements?: string;
  }) =>
    fetchApi<any>('/guides/ai-generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ============================================================================
// Comments API
// ============================================================================

export const commentsApi = {
  list: (achievementId: string, limit = 50, offset = 0) =>
    fetchApi<any[]>(`/comments?achievementId=${achievementId}&limit=${limit}&offset=${offset}`),

  create: (data: {
    achievementId: string;
    contentMd: string;
    parentId?: string;
  }) =>
    fetchApi<any>('/comments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (commentId: string, contentMd: string) =>
    fetchApi<any>('/comments', {
      method: 'PUT',
      body: JSON.stringify({ commentId, contentMd }),
    }),

  delete: (commentId: string) =>
    fetchApi<void>(`/comments/${commentId}`, { method: 'DELETE' }),

  react: (commentId: string, reactionType: 'helpful' | 'funny' | 'thanks' | 'heart') =>
    fetchApi<CommentReactions & { userReaction: string }>('/comments/reaction', {
      method: 'POST',
      body: JSON.stringify({ commentId, reactionType }),
    }),
};

// ============================================================================
// Sync API
// ============================================================================

export const syncApi = {
  all: () =>
    fetchApi<{
      steam: SyncResult;
      psn: SyncResult;
      totalGames: number;
      totalAchievements: number;
      errors: string[];
    }>('/sync', { method: 'POST' }),

  status: () =>
    fetchApi<SyncStatus[]>('/sync/status'),

  history: (limit = 20) =>
    fetchApi<any[]>(`/sync/history?limit=${limit}`),

  forceGame: (gameId: string) =>
    fetchApi<{ success: boolean; synced: string }>('/sync/game', {
      method: 'POST',
      body: JSON.stringify({ gameId }),
    }),
};

// ============================================================================
// Community API
// ============================================================================

export const communityApi = {
  feed: (limit = 50) =>
    fetchApi<FeedItem[]>(`/community/feed?limit=${limit}`),

  leaderboard: (limit = 50, period = 'all') =>
    fetchApi<LeaderboardEntry[]>(`/community/leaderboard?limit=${limit}&period=${period}`),

  rank: (period = 'all') =>
    fetchApi<{ unlocked: number; platinums: number; points: number; rank: number | null }>(
      `/community/rank?period=${period}`
    ),
};

// ============================================================================
// Main API object
// ============================================================================

export const api = {
  auth: authApi,
  steam: steamApi,
  discord: discordApi,
  psn: psnApi,
  games: gamesApi,
  guides: guidesApi,
  comments: commentsApi,
  sync: syncApi,
  community: communityApi,
};

export default api;