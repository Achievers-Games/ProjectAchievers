// Frontend IPC layer.
//
// Types and command bindings are GENERATED from the Rust code by
// tauri-specta (any debug build regenerates src/lib/tauri-bindings.ts).
// Only the thin aliases and listen helpers below are maintained by hand.

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

export type { SteamResolvedProfile } from './tauri-bindings';
export type { CommentReactions } from './tauri-bindings';

// Thin helpers kept for convenience (matching the original call sites).
export const tauriApi = {
  // Auth
  authenticateSteam: (request: SteamAuthRequest_Deserialize) =>
    unwrap(commands.authenticateSteam(request)),
  authenticatePsn: (request: { npsso: string }) => unwrap(commands.authenticatePsn(request)),
  getLinkedAccounts: () => unwrap(commands.getLinkedAccounts()),
  unlinkAccount: (accountId: string) => unwrap(commands.unlinkAccount(accountId)),
  getAuthStatus: () => unwrap(commands.getAuthStatus()),

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
};
// fin du module IPC
