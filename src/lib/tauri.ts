import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// Types matching Rust structs
export interface LinkedAccount {
  id: string;
  platform: string;
  platform_user_id: string;
  platform_username: string | null;
  avatar_url: string | null;
  last_synced_at: number | null;
  sync_status: string;
  sync_error: string | null;
}

export interface AuthStatus {
  is_authenticated: boolean;
  user_id: string | null;
  username: string | null;
  linked_accounts: LinkedAccount[];
}

export interface SteamAuthRequest {
  steam_id: string;
  api_key?: string;
}

export interface PsnAuthRequest {
  npsso: string;
}

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number | null;
  img_icon_url: string;
  img_logo_url: string;
  has_community_visible_stats: boolean;
}

export interface SteamPlayerAchievement {
  apiname: string;
  achieved: number;
  unlocktime: number | null;
}

export interface SteamAchievementDefinition {
  name: string;
  displayname: string;
  description: string;
  icon: string;
  icongray: string;
  hidden: number;
}

export interface SteamGameSchema {
  game_name: string;
  game_version: string;
  available_game_stats: {
    achievements: SteamAchievementDefinition[];
  };
}

export interface SteamGlobalAchievement {
  name: string;
  percent: number;
}

export interface SyncResult {
  synced_games: number;
  synced_achievements: number;
  errors: string[];
}

export interface SyncAllResult {
  steam: SyncResult;
  psn: SyncResult;
  total_games: number;
  total_achievements: number;
  duration_ms: number;
}

export interface SyncStatus {
  platform: string;
  last_synced_at: number | null;
  sync_status: string;
  sync_error: string | null;
  games_synced: number;
  achievements_synced: number;
}

export interface GameListItem {
  id: string;
  name: string;
  slug: string;
  cover_url: string | null;
  header_url: string | null;
  platform: string;
  total_achievements: number;
  release_date: number | null;
  genres: string[];
  user_progress: UserGameProgress | null;
}

export interface UserGameProgress {
  unlocked_count: number;
  total_count: number;
  completion_percentage: number;
  platinum_unlocked: boolean;
  last_unlocked_at: number | null;
}

export interface AchievementWithProgress {
  id: string;
  platform_achievement_id: string;
  name: string;
  description: string;
  icon_url: string | null;
  icon_gray_url: string | null;
  hidden: boolean;
  trophy_type: string | null;
  global_rarity: number;
  points: number;
  is_platinum: boolean;
  unlocked: boolean;
  unlocked_at: number | null;
  rarity_at_unlock: number | null;
}

export interface GameDetail {
  id: string;
  name: string;
  slug: string;
  cover_url: string | null;
  header_url: string | null;
  platform: string;
  steam_app_id: number | null;
  psn_title_id: string | null;
  total_achievements: number;
  platinum_achievement_id: string | null;
  release_date: number | null;
  genres: string[];
  developers: string[];
  publishers: string[];
  description: string | null;
  user_progress: UserGameProgress | null;
  achievements: AchievementWithProgress[];
}

export interface GameSearchResult {
  id: string;
  name: string;
  slug: string;
  cover_url: string | null;
  platform: string;
  total_achievements: number;
}

export interface AchievementGuide {
  id: string;
  achievement_id: string;
  author_id: string;
  author_username: string;
  author_avatar: string | null;
  content_md: string;
  content_type: string;
  video_url: string | null;
  images: string[];
  ai_generated: boolean;
  ai_model: string | null;
  version: number;
  parent_guide_id: string | null;
  status: string;
  verified: boolean;
  verified_by: string | null;
  verified_at: number | null;
  upvotes: number;
  downvotes: number;
  user_vote: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateGuideRequest {
  achievement_id: string;
  content_md: string;
  content_type: string;
  video_url: string | null;
  images: string[];
}

export interface UpdateGuideRequest {
  guide_id: string;
  content_md?: string;
  video_url?: string | null;
  images?: string[] | null;
  status?: string | null;
}

export interface AIGuideRequest {
  achievement_id: string;
  game_name: string;
  achievement_name: string;
  achievement_description: string;
  trophy_type: string | null;
  known_requirements: string | null;
}

export interface VoteResult {
  upvotes: number;
  downvotes: number;
  user_vote: string | null;
}

export interface Comment {
  id: string;
  achievement_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content_md: string;
  parent_id: string | null;
  depth: number;
  reactions: CommentReactions;
  user_reaction: string | null;
  reply_count: number;
  is_deleted: boolean;
  created_at: number;
  updated_at: number;
  replies: Comment[] | null;
}

export interface CommentReactions {
  helpful: number;
  funny: number;
  thanks: number;
  heart: number;
}

export interface CreateCommentRequest {
  achievement_id: string;
  content_md: string;
  parent_id: string | null;
}

export interface UpdateCommentRequest {
  comment_id: string;
  content_md: string;
}

export interface ReactionRequest {
  comment_id: string;
  reaction_type: string;
}

export interface AppVersion {
  version: string;
  app_name: string;
}

export interface UpdateInfo {
  available: boolean;
  version: string | null;
  notes: string | null;
  date: string | null;
}

// Tauri invoke helpers with proper typing
export const tauriApi = {
  // Auth
  authenticateSteam: (request: SteamAuthRequest) =>
    invoke<LinkedAccount>('authenticate_steam', { request }),
  authenticatePsn: (request: PsnAuthRequest) =>
    invoke<LinkedAccount>('authenticate_psn', { request }),
  getLinkedAccounts: () => invoke<LinkedAccount[]>('get_linked_accounts'),
  unlinkAccount: (accountId: string) =>
    invoke('unlink_account', { account_id: accountId }),
  getAuthStatus: () => invoke<AuthStatus>('get_auth_status'),

  // Steam
  steamGetOwnedGames: () => invoke<SteamOwnedGame[]>('steam_get_owned_games'),
  steamGetPlayerAchievements: (appId: number) =>
    invoke<SteamPlayerAchievement[]>('steam_get_player_achievements', { app_id: appId }),
  steamGetGameSchema: (appId: number) =>
    invoke<SteamGameSchema>('steam_get_game_schema', { app_id: appId }),
  steamGetGlobalAchievementPercentages: (appId: number) =>
    invoke<SteamGlobalAchievement[]>('steam_get_global_achievement_percentages', { app_id: appId }),
  steamSyncUserData: () => invoke<SyncResult>('steam_sync_user_data'),

  // PSN
  psnGetTrophyTitles: () => invoke<any[]>('psn_get_trophy_titles'),
  psnGetTrophyGroups: (npCommunicationId: string) =>
    invoke<any[]>('psn_get_trophy_groups', { np_communication_id: npCommunicationId }),
  psnGetTrophies: (npCommunicationId: string, trophyGroupId: string) =>
    invoke<any[]>('psn_get_trophies', { np_communication_id: npCommunicationId, trophy_group_id: trophyGroupId }),
  psnSyncUserData: () => invoke<any>('psn_sync_user_data'),
  psnImportFromPsnprofiles: (username: string) =>
    invoke<any>('psn_import_from_psnprofiles', { psnprofiles_username: username }),
  psnAddManualTrophy: (data: {
    game_name: string;
    trophy_name: string;
    trophy_type: string;
    description: string;
    earned: boolean;
    earned_date: string | null;
  }) => invoke<string>('psn_add_manual_trophy', data),

  // Games
  getGames: (params?: {
    platform?: string;
    genre?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => invoke<GameListItem[]>('get_games', params ?? {}),
  getGameDetail: (gameId: string) =>
    invoke<GameDetail>('get_game_detail', { game_id: gameId }),
  searchGames: (query: string, limit?: number) =>
    invoke<GameSearchResult[]>('search_games', { query, limit }),
  getUserGameProgress: (gameId: string) =>
    invoke<UserGameProgress>('get_user_game_progress', { game_id: gameId }),

  // Guides
  getAchievementGuides: (achievementId: string) =>
    invoke<AchievementGuide[]>('get_achievement_guides', { achievement_id: achievementId }),
  createGuide: (request: CreateGuideRequest) =>
    invoke<AchievementGuide>('create_guide', { request }),
  updateGuide: (request: UpdateGuideRequest) =>
    invoke<AchievementGuide>('update_guide', { request }),
  deleteGuide: (guideId: string) =>
    invoke('delete_guide', { guide_id: guideId }),
  voteGuide: (guideId: string, voteType: 'up' | 'down') =>
    invoke<VoteResult>('vote_guide', { guide_id: guideId, vote_type: voteType }),
  generateAiGuide: (request: AIGuideRequest) =>
    invoke<AchievementGuide>('generate_ai_guide', { request }),

  // Comments
  getComments: (achievementId: string, limit?: number, offset?: number) =>
    invoke<Comment[]>('get_comments', { achievement_id: achievementId, limit, offset }),
  createComment: (request: CreateCommentRequest) =>
    invoke<Comment>('create_comment', { request }),
  updateComment: (request: UpdateCommentRequest) =>
    invoke<Comment>('update_comment', { request }),
  deleteComment: (commentId: string) =>
    invoke('delete_comment', { comment_id: commentId }),
  reactToComment: (request: ReactionRequest) =>
    invoke<CommentReactions>('react_to_comment', { request }),

  // Sync
  syncAllPlatforms: () => invoke<SyncAllResult>('sync_all_platforms'),
  getSyncStatus: () => invoke<SyncStatus[]>('get_sync_status'),
  triggerBackgroundSync: () => invoke('trigger_background_sync'),
  getSyncHistory: (limit?: number) =>
    invoke<any[]>('get_sync_history', { limit }),
  forceSyncGame: (gameId: string) =>
    invoke<SyncResult>('force_sync_game', { game_id: gameId }),

  // System
  getAppVersion: () => invoke<AppVersion>('get_app_version'),
  openExternalUrl: (url: string) => invoke('open_external_url', { url }),
  showInFolder: (path: string) => invoke('show_in_folder', { path }),
  checkForUpdates: () => invoke<UpdateInfo>('check_for_updates'),
  installUpdate: () => invoke('install_update'),
  minimizeToTray: () => invoke('minimize_to_tray'),
  showWindow: () => invoke('show_window'),

  // Listen for events
  listenToTraySync: (callback: () => void) => {
    return listen('tray-sync', () => callback());
  },
  listenToGlobalShortcutShow: (callback: () => void) => {
    return listen('global-shortcut-show', () => callback());
  },
};

// Window reference
export const mainWindow = WebviewWindow.getByLabel('main');