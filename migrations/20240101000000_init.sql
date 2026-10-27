-- Project Achievers - Initial Schema
-- SQLite with sqlx migrations

-- Users table (local profile + linked platforms)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Platform accounts (Steam, PSN, etc.)
CREATE TABLE IF NOT EXISTS platform_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL, -- 'steam', 'psn', 'xbox'
    platform_user_id TEXT NOT NULL,
    platform_username TEXT,
    avatar_url TEXT,
    encrypted_access_token TEXT, -- Encrypted Steam API key / NPSSO
    last_synced_at INTEGER,
    sync_status TEXT DEFAULT 'pending', -- 'pending', 'syncing', 'completed', 'failed'
    sync_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, platform)
);

-- Games (from Steam/PSN)
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    steam_app_id INTEGER UNIQUE,
    psn_title_id TEXT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    cover_url TEXT, -- library_600x900.jpg (portrait)
    header_url TEXT, -- header.jpg (landscape)
    platform TEXT NOT NULL, -- 'steam', 'psn', 'xbox'
    total_achievements INTEGER DEFAULT 0,
    platinum_achievement_id TEXT,
    release_date INTEGER,
    genres_json TEXT DEFAULT '[]', -- JSON array of strings
    developers_json TEXT DEFAULT '[]',
    publishers_json TEXT DEFAULT '[]',
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Achievements / Trophies
CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    platform_achievement_id TEXT NOT NULL, -- Steam API name / PSN trophy ID
    name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    icon_gray_url TEXT,
    hidden INTEGER DEFAULT 0,
    trophy_type TEXT DEFAULT 'achievement', -- 'platinum', 'gold', 'silver', 'bronze', 'achievement'
    global_rarity REAL DEFAULT 0.0,
    points INTEGER DEFAULT 0,
    is_platinum INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    UNIQUE (game_id, platform_achievement_id)
);

-- User achievement progress
CREATE TABLE IF NOT EXISTS user_achievements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER,
    rarity_at_unlock REAL DEFAULT 0.0,
    platform TEXT NOT NULL, -- 'steam', 'psn'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
    UNIQUE (user_id, achievement_id)
);

-- Community guides
CREATE TABLE IF NOT EXISTS achievement_guides (
    id TEXT PRIMARY KEY,
    achievement_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content_md TEXT NOT NULL,
    content_type TEXT DEFAULT 'community', -- 'community', 'ai', 'official'
    video_url TEXT,
    images_json TEXT DEFAULT '[]',
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    ai_generated INTEGER DEFAULT 0,
    status TEXT DEFAULT 'published', -- 'published', 'draft', 'hidden'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Comments on achievements
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    achievement_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    parent_id TEXT, -- NULL for top-level, set for replies
    content_md TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- Comment reactions
CREATE TABLE IF NOT EXISTS comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction_type TEXT NOT NULL, -- 'helpful', 'funny', 'thanks', 'heart'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (comment_id, user_id, reaction_type)
);

-- Guide votes
CREATE TABLE IF NOT EXISTS guide_votes (
    id TEXT PRIMARY KEY,
    guide_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    vote_type TEXT NOT NULL, -- 'up', 'down'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (guide_id) REFERENCES achievement_guides(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (guide_id, user_id)
);

-- Community feed items
CREATE TABLE IF NOT EXISTS feed_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'achievement_unlocked', 'guide_published', 'comment_posted'
    related_id TEXT NOT NULL, -- achievement_id, guide_id, or comment_id
    message TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sync history
CREATE TABLE IF NOT EXISTS sync_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    synced_at INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'completed', 'partial', 'failed'
    games_synced INTEGER DEFAULT 0,
    achievements_synced INTEGER DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_platform_accounts_user_id ON platform_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);
CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug);
CREATE INDEX IF NOT EXISTS idx_achievements_game_id ON achievements(game_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id ON user_achievements(achievement_id);
CREATE INDEX IF NOT EXISTS idx_guides_achievement_id ON achievement_guides(achievement_id);
CREATE INDEX IF NOT EXISTS idx_comments_achievement_id ON comments(achievement_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_user_id ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_history_user_id ON sync_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked_at ON user_achievements(unlocked_at);