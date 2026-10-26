-- Project Achievers Database Schema
-- Initial migration

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    avatar_url TEXT,
    display_name TEXT,
    bio TEXT,
    settings_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Platform accounts (Steam, PSN, Xbox)
CREATE TABLE IF NOT EXISTS platform_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('steam', 'psn', 'xbox')),
    platform_user_id TEXT NOT NULL,
    platform_username TEXT,
    avatar_url TEXT,
    encrypted_access_token TEXT,
    encrypted_refresh_token TEXT,
    token_expires_at INTEGER,
    last_synced_at INTEGER,
    sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed')),
    sync_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(user_id, platform)
);

-- Games table
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    steam_app_id INTEGER UNIQUE,
    psn_title_id TEXT UNIQUE,
    xbox_title_id TEXT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    cover_url TEXT,
    header_url TEXT,
    platform TEXT NOT NULL CHECK (platform IN ('steam', 'psn', 'xbox', 'multi')),
    total_achievements INTEGER DEFAULT 0,
    platinum_achievement_id TEXT,
    release_date INTEGER,
    genres_json TEXT DEFAULT '[]',
    developers_json TEXT DEFAULT '[]',
    publishers_json TEXT DEFAULT '[]',
    description TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Achievements table
CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    platform_achievement_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    icon_gray_url TEXT,
    hidden BOOLEAN DEFAULT FALSE,
    trophy_type TEXT CHECK (trophy_type IN ('platinum', 'gold', 'silver', 'bronze', 'achievement')),
    global_rarity REAL DEFAULT 0.0,
    points INTEGER DEFAULT 0,
    is_platinum BOOLEAN DEFAULT FALSE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(game_id, platform_achievement_id)
);

-- User achievements (unlocked achievements)
CREATE TABLE IF NOT EXISTS user_achievements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at INTEGER NOT NULL,
    rarity_at_unlock REAL,
    platform TEXT NOT NULL CHECK (platform IN ('steam', 'psn', 'xbox')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(user_id, achievement_id)
);

-- Achievement guides
CREATE TABLE IF NOT EXISTS achievement_guides (
    id TEXT PRIMARY KEY,
    achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_md TEXT NOT NULL,
    content_type TEXT DEFAULT 'community' CHECK (content_type IN ('ai', 'community', 'official')),
    video_url TEXT,
    images_json TEXT DEFAULT '[]',
    ai_generated BOOLEAN DEFAULT FALSE,
    ai_model TEXT,
    version INTEGER DEFAULT 1,
    parent_guide_id TEXT REFERENCES achievement_guides(id),
    status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    verified BOOLEAN DEFAULT FALSE,
    verified_by TEXT REFERENCES users(id),
    verified_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Guide votes
CREATE TABLE IF NOT EXISTS guide_votes (
    id TEXT PRIMARY KEY,
    guide_id TEXT NOT NULL REFERENCES achievement_guides(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(guide_id, user_id)
);

-- Comments (threaded)
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_md TEXT NOT NULL,
    parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
    reaction_counts_json TEXT DEFAULT '{}',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Comment reactions
CREATE TABLE IF NOT EXISTS comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL CHECK (reaction_type IN ('helpful', 'funny', 'thanks', 'heart')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(comment_id, user_id, reaction_type)
);

-- Recommendations
CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    reason TEXT,
    algorithm TEXT DEFAULT 'hybrid',
    generated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    viewed_at INTEGER,
    dismissed_at INTEGER,
    UNIQUE(user_id, game_id)
);

-- Friends / Social
CREATE TABLE IF NOT EXISTS follows (
    id TEXT PRIMARY KEY,
    follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(follower_id, following_id)
);

-- Activity feed
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('achievement_unlocked', 'guide_created', 'guide_updated', 'comment_created', 'game_completed', 'platinum_earned')),
    reference_id TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('guide_update', 'comment_reply', 'mention', 'achievement_unlock', 'friend_activity', 'recommendation', 'system')),
    title TEXT NOT NULL,
    message TEXT,
    reference_id TEXT,
    reference_type TEXT,
    read BOOLEAN DEFAULT FALSE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Settings (key-value for user preferences)
CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(user_id, key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_platform_accounts_user_id ON platform_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_accounts_platform ON platform_accounts(platform);

CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);
CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug);
CREATE INDEX IF NOT EXISTS idx_games_steam_app_id ON games(steam_app_id);
CREATE INDEX IF NOT EXISTS idx_games_psn_title_id ON games(psn_title_id);

CREATE INDEX IF NOT EXISTS idx_achievements_game_id ON achievements(game_id);
CREATE INDEX IF NOT EXISTS idx_achievements_trophy_type ON achievements(trophy_type);
CREATE INDEX IF NOT EXISTS idx_achievements_hidden ON achievements(hidden);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id ON user_achievements(achievement_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked_at ON user_achievements(unlocked_at);

CREATE INDEX IF NOT EXISTS idx_guides_achievement_id ON achievement_guides(achievement_id);
CREATE INDEX IF NOT EXISTS idx_guides_author_id ON achievement_guides(author_id);
CREATE INDEX IF NOT EXISTS idx_guides_status ON achievement_guides(status);

CREATE INDEX IF NOT EXISTS idx_comments_achievement_id ON comments(achievement_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);

CREATE INDEX IF NOT EXISTS idx_recommendations_user_id ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_score ON recommendations(score DESC);

CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);

-- Triggers for updated_at
CREATE TRIGGER IF NOT EXISTS update_users_timestamp
AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_platform_accounts_timestamp
AFTER UPDATE ON platform_accounts
BEGIN
    UPDATE platform_accounts SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_games_timestamp
AFTER UPDATE ON games
BEGIN
    UPDATE games SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_achievements_timestamp
AFTER UPDATE ON achievements
BEGIN
    UPDATE achievements SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_guides_timestamp
AFTER UPDATE ON achievement_guides
BEGIN
    UPDATE achievement_guides SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_comments_timestamp
AFTER UPDATE ON comments
BEGIN
    UPDATE comments SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_user_settings_timestamp
AFTER UPDATE ON user_settings
BEGIN
    UPDATE user_settings SET updated_at = strftime('%s', 'now') * 1000 WHERE id = NEW.id;
END;