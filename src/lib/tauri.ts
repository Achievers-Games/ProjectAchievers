// Frontend IPC layer.
//
// Types and command bindings are GENERATED from the Rust code by
// tauri-specta (any debug build regenerates src/lib/tauri-bindings.ts).
// Only the thin aliases and listen helpers below are maintained by hand.

import { isTauri } from './tauri-env';

// In a regular browser, use the browser API client that calls the backend HTTP server.
// In Tauri mode, use the real IPC commands bound via tauri-specta.
import { browserApi } from './browser-api';

import { listen } from '@tauri-apps/api/event';
import {
  commands,
  type AIGuideRequest_Deserialize,
  type AchievementDetail_Serialize,
  type AchievementGuide_Serialize,
  type AchievementWithProgress_Serialize,
  type AuthStatus_Serialize,
  type Comment_Serialize,
  type CreateCommentRequest_Deserialize,
  type CreateGuideRequest_Deserialize,
  type FeedItem_Serialize,
  type GameDetail_Serialize,
  type GameListItem_Serialize,
  type GameSearchResult_Serialize,
  type LeaderboardEntry_Serialize,
  type LinkedAccount_Serialize,
  type ReactionRequest,
  type RefreshResult as RefreshResultType,
  type SessionInfo as SessionInfoType,
  type SessionTokens as SessionTokensType,
  type SteamAuthRequest_Deserialize,
  type SteamGameSchema,
  type SteamOwnedGame_Serialize,
  type SteamPlayerAchievement_Serialize,
  type SyncAllResult,
  type SyncHistoryEntry_Serialize,
  type SyncResult,
  type SyncStatus_Serialize,
  type UpdateCommentRequest,
  type UpdateGuideRequest_Deserialize,
  type UpdateInfo_Serialize,
  type AppVersion,
  type UserGameProgress_Serialize,
} from './tauri-bindings';

export { commands };

// tauri-specta wraps every command result as { status: "ok", data } |
// { status: "error", error }. We unwrap back to the plain invoke() shape:
// Promise resolving with data, rejecting with the AppError payload.
type UnwrapOk<R> = R extends { status: 'ok'; data: infer D } ? D : never;

async function unwrap<R extends { status: 'ok' | 'error' }>(
  p: Promise<R>,
): Promise<R extends { status: 'ok'; data: infer D } ? D : never> {
  const result: { status: 'ok' | 'error'; error?: unknown; data?: unknown } = await p;
  if (result.status === 'error') {
    throw result.error;
  }
  return result.data as UnwrapOk<R>;
}

// Hand-written aliases so components keep the original type names.
export type {
  SteamGameSchema,
  UpdateCommentRequest,
  ReactionRequest,
  AppVersion,
  SyncResult,
  SyncAllResult,
};
export type LinkedAccount = LinkedAccount_Serialize;
export type AuthStatus = AuthStatus_Serialize;
export type { LinkedAccount_Serialize, AuthStatus_Serialize };
export type SteamOwnedGame = SteamOwnedGame_Serialize;
export type SteamPlayerAchievement = SteamPlayerAchievement_Serialize;
export type GameListItem = GameListItem_Serialize;
export type GameSearchResult = GameSearchResult_Serialize;
export type UserGameProgress = UserGameProgress_Serialize;
export type AchievementWithProgress = AchievementWithProgress_Serialize;
export type GameDetail = GameDetail_Serialize;
export type AchievementDetail = AchievementDetail_Serialize;
export type AchievementGuide = AchievementGuide_Serialize;
export type CreateGuideRequest = CreateGuideRequest_Deserialize;
export type UpdateGuideRequest = UpdateGuideRequest_Deserialize;
export type AIGuideRequest = AIGuideRequest_Deserialize;
export type Comment = Comment_Serialize;
export type CreateCommentRequest = CreateCommentRequest_Deserialize;
export type SyncStatus = SyncStatus_Serialize;
export type SyncHistoryEntry = SyncHistoryEntry_Serialize;
export type UpdateInfo = UpdateInfo_Serialize;
export type FeedItem = FeedItem_Serialize;
export type LeaderboardEntry = LeaderboardEntry_Serialize;
export type SessionInfo = SessionInfoType;
export type SessionTokens = SessionTokensType;
export type RefreshResult = RefreshResultType;

export type { SteamResolvedProfile } from './tauri-bindings';
export type { CommentReactions } from './tauri-bindings';

// Thin helpers kept for convenience (matching the original call sites).
const realTauriApi = {
  // Auth
  authenticateSteam: (request: SteamAuthRequest_Deserialize) =>
    unwrap(commands.authenticateSteam(request)),
  authenticatePsn: (request: { npsso: string }) => unwrap(commands.authenticatePsn(request)),
  getLinkedAccounts: () => unwrap(commands.getLinkedAccounts()),
  unlinkAccount: (accountId: string) => unwrap(commands.unlinkAccount(accountId)),
  getAuthStatus: () => unwrap(commands.getAuthStatus()),

  // OAuth 2.0 — Steam OpenID
  steamOpenidUrl: (state: string) => unwrap(commands.steamOpenidUrl(state)),
  steamOpenidCallback: (openidParams: Record<string, string>, state: string) =>
    unwrap(commands.steamOpenidCallback(openidParams as any, state)),
  steamOpenidLinkUrl: (state: string) => unwrap(commands.steamOpenidLinkUrl(state)),

  // OAuth 2.0 — Discord (PKCE)
  discordOauthUrl: () => unwrap(commands.discordOauthUrl()),
  discordOauthCallback: (code: string, state: string) =>
    unwrap(commands.discordOauthCallback(code, state)),
  discordRefreshToken: () => unwrap(commands.discordRefreshToken()),
  discordRevoke: () => unwrap(commands.discordRevoke()),

  // OAuth 2.0 — provider-agnostic loopback flow
  oauthBegin: (provider: 'steam' | 'discord') => unwrap(commands.oauthBegin(provider)),

  // Session / JWT
  createSession: (userAgent?: string | null) => unwrap(commands.createSession(userAgent ?? null)),
  validateSession: (accessToken: string) => unwrap(commands.validateSession(accessToken)),
  refreshSession: (refreshToken: string) => unwrap(commands.refreshSession(refreshToken)),
  revokeSession: (sessionId: string) => unwrap(commands.revokeSession(sessionId)),
  revokeOtherSessions: (currentSessionId: string) => unwrap(commands.revokeOtherSessions(currentSessionId)),
  getSessions: () => unwrap(commands.getSessions()),

  // Steam
  steamGetOwnedGames: () => unwrap(commands.steamGetOwnedGames()),
  steamGetPlayerAchievements: (appId: number) => unwrap(commands.steamGetPlayerAchievements(appId)),
  steamGetGameSchema: (appId: number) => unwrap(commands.steamGetGameSchema(appId)),
  steamGetGlobalAchievementPercentages: (appId: number) =>
    unwrap(commands.steamGetGlobalAchievementPercentages(appId)),
  steamSyncUserData: () => unwrap(commands.steamSyncUserData()),
  steamResolveVanity: (profile: string) => unwrap(commands.steamResolveVanity(profile)),

  // PSN
  psnGetTrophyTitles: () => unwrap(commands.psnGetTrophyTitles()),
  psnGetTrophyGroups: (npCommunicationId: string) =>
    unwrap(commands.psnGetTrophyGroups(npCommunicationId)),
  psnGetTrophies: (npCommunicationId: string, trophyGroupId: string) =>
    unwrap(commands.psnGetTrophies(npCommunicationId, trophyGroupId)),
  psnSyncUserData: () => unwrap(commands.psnSyncUserData()),
  psnImportFromPsnprofiles: (username: string) =>
    unwrap(commands.psnImportFromPsnprofiles(username)),
  psnAddManualTrophy: (
    gameName: string,
    trophyName: string,
    trophyType: string,
    description: string,
    earned: boolean,
    earnedDate: string | null,
  ) =>
    unwrap(
      commands.psnAddManualTrophy(gameName, trophyName, trophyType, description, earned, earnedDate),
    ),

  // Games
  getGames: (params?: {
    platform?: string;
    genre?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) =>
    unwrap(
      commands.getGames(
        params?.platform ?? null,
        params?.genre ?? null,
        params?.search ?? null,
        params?.limit ?? null,
        params?.offset ?? null,
      ),
    ),
  getGameDetail: (gameId: string) => unwrap(commands.getGameDetail(gameId)),
  getAchievementDetail: (achievementId: string) =>
    unwrap(commands.getAchievementDetail(achievementId)),
  searchGames: (query: string, limit?: number) =>
    unwrap(commands.searchGames(query, limit ?? null)),
  getUserGameProgress: (gameId: string) => unwrap(commands.getUserGameProgress(gameId)),

  // Guides
  getAchievementGuides: (achievementId: string) =>
    unwrap(commands.getAchievementGuides(achievementId)),
  createGuide: async (request: CreateGuideRequest_Deserialize) =>
    unwrap(commands.createGuide(request)),
  updateGuide: async (request: UpdateGuideRequest_Deserialize) =>
    unwrap(commands.updateGuide(request)),
  deleteGuide: (guideId: string) => unwrap(commands.deleteGuide(guideId)),
  voteGuide: (guideId: string, voteType: 'up' | 'down') =>
    unwrap(commands.voteGuide(guideId, voteType)),
  generateAiGuide: (request: AIGuideRequest_Deserialize) => unwrap(commands.generateAiGuide(request)),

  // Comments
  getComments: (achievementId: string, limit?: number, offset?: number) =>
    unwrap(commands.getComments(achievementId, limit ?? null, offset ?? null)),
  createComment: (request: CreateCommentRequest_Deserialize) =>
    unwrap(commands.createComment(request)),
  updateComment: (request: UpdateCommentRequest) => unwrap(commands.updateComment(request)),
  deleteComment: (commentId: string) => unwrap(commands.deleteComment(commentId)),
  reactToComment: (request: ReactionRequest) => unwrap(commands.reactToComment(request)),

  // Sync
  syncAllPlatforms: () => unwrap(commands.syncAllPlatforms()),
  getSyncStatus: () => unwrap(commands.getSyncStatus()),
  triggerBackgroundSync: () => unwrap(commands.triggerBackgroundSync()),
  getSyncHistory: (limit?: number) => unwrap(commands.getSyncHistory(limit ?? null)),
  forceSyncGame: (gameId: string) => unwrap(commands.forceSyncGame(gameId)),

  // Communauté
  getCommunityFeed: (limit?: number) => unwrap(commands.getCommunityFeed(limit ?? null)),
  getLeaderboard: (limit?: number) => unwrap(commands.getLeaderboard(limit ?? null)),

  // System
  getAppVersion: () => unwrap(commands.getAppVersion()),
  openExternalUrl: (url: string) => unwrap(commands.openExternalUrl(url)),
  showInFolder: (path: string) => unwrap(commands.showInFolder(path)),
  checkForUpdates: () => unwrap(commands.checkForUpdates()),
  installUpdate: () => unwrap(commands.installUpdate()),
  minimizeToTray: () => unwrap(commands.minimizeToTray()),
  showWindow: () => unwrap(commands.showWindow()),

  // Listen for events
  listenToTraySync: (callback: () => void) => {
    return listen('tray-sync', () => callback());
  },
  listenToGlobalShortcutShow: (callback: () => void) => {
    return listen('global-shortcut-show', () => callback());
  },
  listenToOAuthCallback: (callback: (payload: OAuthCallbackPayload) => void) => {
    return listen<OAuthCallbackPayload>('oauth-callback', (event) => callback(event.payload));
  },
};

export interface OAuthCallbackPayload {
  provider: string;
  code: string | null;
  state: string;
  error: string | null;
  error_description: string | null;
  // For Steam OpenID - contains all openid.* parameters
  openidParams?: Record<string, string>;
}

// Expose tauriApi — uses browser API in regular browser, real bindings in Tauri app
export const tauriApi: typeof realTauriApi = isTauri() ? realTauriApi : browserApi;

/**
 * Run an OAuth/OpenID authorization.
 *
 * In Tauri mode: uses the Rust loopback server flow (oauthBegin + listenToOAuthCallback).
 * In browser mode: calls the backend API for the provider URL and redirects the browser.
 *   The backend handles verification and redirects back to /settings with success/error params.
 */
export async function runOAuth(
  provider: 'steam' | 'discord',
): Promise<{ success: boolean; error?: string }> {
  if (!isTauri()) {
    return browserRunOAuth(provider);
  }
  return realRunOAuth(provider);
}

/**
 * Browser OAuth flow — uses the backend API to get the provider URL,
 * then redirects the browser to the provider for authentication.
 * The backend handles the callback and redirects back to /settings.
 */
async function browserRunOAuth(
  provider: 'steam' | 'discord',
): Promise<{ success: boolean; error?: string }> {
  try {
    let redirectUrl: string;

    if (provider === 'steam') {
      // Steam OpenID — backend generates the URL
      const state = generateState(32);
      const response = await fetch('http://localhost:3001/api/steam/oauth/url?state=' + encodeURIComponent(state), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Failed to get Steam OAuth URL: ${response.statusText}`);
      }
      const data = await response.json();
      redirectUrl = data.url;
      // Store state in sessionStorage for the return page to verify
      sessionStorage.setItem('pa_oauth_state', state);
    } else {
      // Discord OAuth2 with PKCE — backend generates the URL + state
      const response = await fetch('http://localhost:3001/api/discord/oauth/url', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Failed to get Discord OAuth URL: ${response.statusText}`);
      }
      const data = await response.json();
      redirectUrl = data.url;
      sessionStorage.setItem('pa_oauth_state', data.state);
    }

    // Redirect the browser to the OAuth provider.
    // This will unload the current page, so the promise below won't resolve.
    // The backend will redirect back to /settings after completion.
    window.location.href = redirectUrl;

    // This never executes (page is navigating), but TypeScript needs a return
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// ── Browser helpers ────────────────────────────────────────────────────────

/** Generate a URL-safe random string for OAuth `state`. */
function generateState(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, length);
}

async function realRunOAuth(
  provider: 'steam' | 'discord',
): Promise<{ success: boolean; error?: string }> {
  const listeners: { stop: (() => void) | null } = { stop: null };
  let resolveCallback!: (payload: OAuthCallbackPayload) => void;
  let rejectCallback!: (error: unknown) => void;

  const callbackPromise = new Promise<OAuthCallbackPayload>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const timeout = setTimeout(() => {
    rejectCallback(new Error("Délai d'attente OAuth/OpenID dépassé (5 minutes)."));
  }, 5 * 60 * 1000);

  const registration = realTauriApi
    .listenToOAuthCallback((payload) => {
      if (payload.provider !== provider) return;
      clearTimeout(timeout);
      resolveCallback(payload);
    })
    .then((stop) => {
      listeners.stop = stop;
    });

  try {
    // Make sure the event listener is registered before the browser flow starts.
    await registration;
    const begin = await realTauriApi.oauthBegin(provider);
    await realTauriApi.openExternalUrl(begin.url);

    const payload = await callbackPromise;
    if (payload.error) {
      return {
        success: false,
        error: payload.error_description ?? payload.error,
      };
    }

    if (provider === 'steam') {
      // Steam uses OpenID 2.0 - pass all openid.* parameters
      if (!payload.openidParams || Object.keys(payload.openidParams).length === 0) {
        return { success: false, error: "Aucun paramètre OpenID reçu de Steam." };
      }
      // Pass openidParams as a struct
      await realTauriApi.steamOpenidCallback(payload.openidParams, payload.state);
    } else {
      // Discord uses OAuth2 with code
      if (!payload.code) {
        return { success: false, error: "Aucun code d'autorisation reçu." };
      }
      await realTauriApi.discordOauthCallback(payload.code, payload.state);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
    listeners.stop?.();
  }
}
// fin du module IPC
