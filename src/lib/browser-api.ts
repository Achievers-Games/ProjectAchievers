/**
 * Browser-compatible API layer that calls the backend Express server via HTTP.
 *
 * This replaces the mock layer when the app runs in a regular browser.
 * All methods mirror the `realTauriApi` interface from tauri.ts.
 */

import type {
  AuthStatus_Serialize,
  SteamGlobalAchievement_Serialize,
  LinkedAccount_Serialize,
  GameListItem_Serialize,
  GameDetail_Serialize,
  GameSearchResult_Serialize,
  SteamOwnedGame_Serialize,
  SteamPlayerAchievement_Serialize,
  SteamGameSchema_Serialize,
  SyncResult,
  SyncStatus_Serialize,
  SyncHistoryEntry,
  FeedItem_Serialize,
  LeaderboardEntry_Serialize,
  Comment_Serialize,
  CommentReactions,
  ReactionRequest,
  CreateCommentRequest_Deserialize,
  CreateGuideRequest_Deserialize,
  UpdateGuideRequest_Deserialize,
  AIGuideRequest_Deserialize,
  UpdateInfo_Serialize,
  UserGameProgress_Serialize,
  SessionInfo_Serialize,
  SteamSyncResult,
  PsnTrophyTitle_Serialize,
  SessionInfo as SessionInfoType,
  SessionTokens,
  SteamResolvedProfile,
} from './tauri-bindings';

// ── Base URL ──────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/+$/, '');

// ── Helper: typed fetch with error handling ────────────────────────────────
// In browser mode, the backend handles session cookies (credentials: 'include'),
// so we don't need to manually manage auth tokens here — the auth store handles
// that separately for cookie-based session management.

interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined),
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const err: ApiError = new Error(`API error: ${response.status} ${response.statusText}`);
    err.status = response.status;
    try {
      err.data = await response.json();
    } catch {
      // ignore
    }
    throw err;
  }

  // Handle empty response body
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return null as T;
  }

  return response.json() as T;
}

// ── OAuth state helper ────────────────────────────────────────────────────

function generateState(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, length);
}

// ── Browser API implementation ─────────────────────────────────────────────

export const browserApi = {
  // ── Auth ──────────────────────────────────────────────────────────────
  authenticateSteam: (request: unknown) =>
    apiFetch<LinkedAccount_Serialize>('/auth/steam', { method: 'POST', body: JSON.stringify(request) }),
  authenticatePsn: (request: { npsso: string }) =>
    apiFetch<LinkedAccount_Serialize>('/auth/psn', { method: 'POST', body: JSON.stringify(request) }),
  getLinkedAccounts: () =>
    apiFetch<{ id: string; platform: string; platform_user_id: string; platform_username: string | null; avatar_url: string | null; last_synced_at: number | null; sync_status: string; sync_error: string | null }[]>('/auth/accounts'),
  unlinkAccount: (accountId: string) =>
    apiFetch<null>(`/auth/accounts/${accountId}`, { method: 'DELETE' }),
  getAuthStatus: () =>
    apiFetch<{ is_authenticated: boolean; user_id: string | null; username: string | null; linked_accounts: LinkedAccount_Serialize[] }>('/auth/status'),

  // ── OAuth 2.0 — Steam OpenID (backend handles the full flow) ──────────
  steamOpenidUrl: (state: string) =>
    apiFetch<{ url: string }>(`/steam/oauth/url?state=${encodeURIComponent(state)}`).then((data) => data.url),
  steamOpenidCallback: (openidParams: Record<string, string>, state: string) =>
    apiFetch<{ success: boolean; user_id: string; is_new_user: boolean; linked_account: null }>(
      `/steam/oauth/callback?${new URLSearchParams(openidParams).toString()}`,
    ) as Promise<{ success: boolean; user_id: string; is_new_user: boolean; linked_account: null }>,
  steamOpenidLinkUrl: (state: string) =>
    apiFetch<{ url: string }>(`/steam/oauth/link/url?state=${encodeURIComponent(state)}`).then((data) => data.url),

  // ── OAuth 2.0 — Discord (PKCE) ────────────────────────────────────────
  discordOauthUrl: () =>
    apiFetch<{ url: string; state: string; code_verifier: string }>('/discord/oauth/url'),
  discordOauthCallback: (code: string, state: string) =>
    apiFetch<{ success: boolean; user_id: string; is_new_user: boolean; linked_account: null }>(
      `/discord/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    ) as Promise<{ success: boolean; user_id: string; is_new_user: boolean; linked_account: null }>,
  discordRefreshToken: () => apiFetch<null>('/discord/refresh', { method: 'POST' }),
  discordRevoke: () => apiFetch<null>('/discord/revoke', { method: 'POST' }),

  // ── OAuth generic ─────────────────────────────────────────────────────
  oauthBegin: (provider: string) =>
    apiFetch<{ url: string; state: string; provider: string }>(`/oauth/begin?provider=${encodeURIComponent(provider)}`),

  // ── Session / JWT ─────────────────────────────────────────────────────
  createSession: (userAgent?: string | null) =>
    apiFetch<{ access_token: string; refresh_token: string; access_expires_at: number; refresh_expires_at: number; session_id: string }>(
      '/auth/session',
      { method: 'POST', body: JSON.stringify({ userAgent: userAgent ?? null }) },
    ),
  validateSession: (accessToken: string) =>
    apiFetch<unknown>(
      '/auth/verify',
      { method: 'POST', body: JSON.stringify({ accessToken }) },
    ) as Promise<SessionInfo_Serialize>,
  refreshSession: (refreshToken: string) =>
    apiFetch<{ access_token: string; refresh_token: string; access_expires_at: number; refresh_expires_at: number }>(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
    ),
  revokeSession: (sessionId: string) =>
    apiFetch<null>(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
  revokeOtherSessions: (currentSessionId: string) =>
    apiFetch<number>('/auth/sessions/revoke-others', { method: 'POST', body: JSON.stringify({ currentSessionId }) }),
  getSessions: () =>
    apiFetch<SessionInfo_Serialize[]>('/auth/sessions'),

  // ── Steam ─────────────────────────────────────────────────────────────
  steamGetOwnedGames: () =>
    apiFetch<SteamOwnedGame_Serialize[]>('/steam/games'),
  steamGetPlayerAchievements: (appId: number) =>
    apiFetch<SteamPlayerAchievement_Serialize[]>(`/steam/achievements/${appId}`),
  steamGetGameSchema: (appId: number) =>
    apiFetch<SteamGameSchema_Serialize>(`/steam/schema/${appId}`),
  steamGetGlobalAchievementPercentages: (appId: number) =>
    apiFetch<SteamGlobalAchievement_Serialize[]>(`/steam/global/${appId}`),
  steamSyncUserData: () =>
    apiFetch<{ synced_games: number; synced_achievements: number; errors: string[] }>('/steam/sync', { method: 'POST' }) as Promise<{ synced_games: number; synced_achievements: number; errors: string[] }>,
  steamResolveVanity: (profile: string) =>
    apiFetch<SteamResolvedProfile | null>(`/steam/resolve/${encodeURIComponent(profile)}`),

  // ── PSN ───────────────────────────────────────────────────────────────
  psnGetTrophyTitles: () => apiFetch<PsnTrophyTitle_Serialize[]>('/psn/trophies/titles'),
  psnGetTrophyGroups: (npCommunicationId: string) =>
    apiFetch<unknown[]>(`/psn/trophies/groups/${encodeURIComponent(npCommunicationId)}`),
  psnGetTrophies: (npCommunicationId: string, trophyGroupId: string) =>
    apiFetch<unknown[]>(`/psn/trophies/${encodeURIComponent(npCommunicationId)}/${encodeURIComponent(trophyGroupId)}`),
  psnSyncUserData: () => apiFetch<{ success: boolean }>('/psn/sync', { method: 'POST' }),
  psnImportFromPsnprofiles: (username: string) =>
    apiFetch<unknown>(`/psn/import/${encodeURIComponent(username)}`, { method: 'POST' }),
  psnAddManualTrophy: (gameName: string, trophyName: string, trophyType: string, description: string, earned: boolean, earnedDate: string | null) =>
    apiFetch<null>('/psn/trophies/manual', {
      method: 'POST',
      body: JSON.stringify({ gameName, trophyName, trophyType, description, earned, earnedDate }),
    }),

  // ── Games ─────────────────────────────────────────────────────────────
  getGames: (params?: {
    platform?: string;
    genre?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const s = new URLSearchParams();
    if (params?.platform) s.append('platform', params.platform);
    if (params?.genre) s.append('genre', params.genre);
    if (params?.search) s.append('search', params.search);
    if (params?.limit) s.append('limit', String(params.limit));
    if (params?.offset) s.append('offset', String(params.offset));
    return apiFetch<{ games: GameListItem_Serialize[]; total: number; limit: number; offset: number }>(
      `/games?${s.toString()}`,
    );
  },
  getGameDetail: (gameId: string) =>
    apiFetch<GameDetail_Serialize>(`/games/${encodeURIComponent(gameId)}`),
  getAchievementDetail: (achievementId: string) =>
    apiFetch<{ id: string; name: string; description: string; unlocked: boolean; icon: string; }>(
      `/achievements/${encodeURIComponent(achievementId)}`,
    ),
  searchGames: (query: string, limit?: number) =>
    apiFetch<GameListItem_Serialize[]>(`/games/search/${encodeURIComponent(query)}?limit=${limit ?? 20}`),
  getUserGameProgress: (gameId: string) =>
    apiFetch<UserGameProgress_Serialize>(`/games/${encodeURIComponent(gameId)}/progress`),

  // ── Guides ────────────────────────────────────────────────────────────
  getAchievementGuides: (achievementId: string) =>
    apiFetch<unknown[]>(`/guides?achievement=${encodeURIComponent(achievementId)}`),
  createGuide: async (request: CreateGuideRequest_Deserialize) =>
    apiFetch<{ id: string; title: string; content: string }>(
      '/guides',
      { method: 'POST', body: JSON.stringify(request) },
    ),
  updateGuide: async (request: UpdateGuideRequest_Deserialize) =>
    apiFetch<{ id: string; title: string; content: string }>(
      '/guides',
      { method: 'PUT', body: JSON.stringify(request) },
    ),
  deleteGuide: (guideId: string) =>
    apiFetch<{ success: boolean }>(`/guides/${encodeURIComponent(guideId)}`, { method: 'DELETE' }),
  voteGuide: (guideId: string, voteType: 'up' | 'down') =>
    apiFetch<{ success: boolean }>(
      `/guides/${encodeURIComponent(guideId)}/vote`,
      { method: 'POST', body: JSON.stringify({ voteType }) },
    ),
  generateAiGuide: (request: AIGuideRequest_Deserialize) =>
    apiFetch<{ title: string; content: string }>(
      '/guides/ai-generate',
      { method: 'POST', body: JSON.stringify(request) },
    ),

  // ── Comments ──────────────────────────────────────────────────────────
  getComments: (achievementId: string, limit?: number, offset?: number) =>
    apiFetch<{ comments: Comment_Serialize[]; total: number }>(
      `/comments?achievement_id=${encodeURIComponent(achievementId)}&limit=${limit ?? 20}&offset=${offset ?? 0}`,
    ),
  createComment: (request: CreateCommentRequest_Deserialize) =>
    apiFetch<Comment_Serialize>(
      '/comments',
      { method: 'POST', body: JSON.stringify(request) },
    ),
  updateComment: (request: UpdateInfo_Serialize) =>
    apiFetch<Comment_Serialize>(
      '/comments',
      { method: 'PUT', body: JSON.stringify(request) },
    ),
  deleteComment: (commentId: string) =>
    apiFetch<{ success: boolean }>(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
  reactToComment: (request: ReactionRequest) =>
    apiFetch<CommentReactions>(
      '/comments/reaction',
      { method: 'POST', body: JSON.stringify(request) },
    ),

  // ── Sync ──────────────────────────────────────────────────────────────
  syncAllPlatforms: () =>
    apiFetch<{ synced_games: number; synced_achievements: number; errors: string[] }>('/sync', { method: 'POST' }),
  getSyncStatus: () =>
    apiFetch<SyncStatus_Serialize>('/sync/status'),
  triggerBackgroundSync: () =>
    apiFetch<{ success: boolean }>('/sync/trigger', { method: 'POST' }),
  getSyncHistory: (limit?: number) =>
    apiFetch<SyncHistoryEntry[]>('/sync/history', { method: 'POST', body: JSON.stringify({ limit }) }),
  forceSyncGame: (gameId: string) =>
    apiFetch<{ success: boolean; game_id: string }>(
      `/sync/game`,
      { method: 'POST', body: JSON.stringify({ gameId }) },
    ),

  // ── Community ──────────────────────────────────────────────────────────
  getCommunityFeed: (limit?: number) =>
    apiFetch<{ items: FeedItem_Serialize[]; total: number }>(
      `/community/feed?limit=${limit ?? 20}`,
    ),
  getLeaderboard: (limit?: number) =>
    apiFetch<LeaderboardEntry_Serialize[]>(
      `/community/leaderboard?limit=${limit ?? 10}`,
    ),
  getRank: () =>
    apiFetch<{ rank: number; total: number } | null>(
      '/community/rank',
    ),

  // ── System ────────────────────────────────────────────────────────────
  getAppVersion: () =>
    apiFetch<{ version: string }>('/system/version').catch(() => ({ version: 'browser' })),
  openExternalUrl: (url: string) => Promise.resolve(),
  showInFolder: (path: string) => Promise.resolve(),
  checkForUpdates: () => Promise.resolve(false),
  installUpdate: () => Promise.resolve(),
  minimizeToTray: () => Promise.resolve(),
  showWindow: () => Promise.resolve(),

  // ── Listen for events (no-ops in browser — polls instead) ─────────────
  listenToTraySync: (callback: () => void) => {
    const interval = setInterval(() => callback(), 30_000);
    return Promise.resolve(() => clearInterval(interval));
  },
  listenToGlobalShortcutShow: (callback: () => void) =>
    Promise.resolve(() => {}),
  listenToOAuthCallback: (callback: (payload: unknown) => void) =>
    Promise.resolve(() => {}),
};
