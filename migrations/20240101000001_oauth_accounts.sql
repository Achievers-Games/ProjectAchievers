-- migrations/20240101000001_oauth_accounts.sql
-- OAuth Accounts & Sessions for multi-provider auth (Steam, Discord, PSN)

-- Sessions utilisateur (JWT stocké côté serveur pour révocation)
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,                    -- UUID
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,               -- SHA-256 du JWT access token
    refresh_token_hash TEXT,                -- SHA-256 du refresh token
    expires_at INTEGER NOT NULL,            -- Unix ms (access token expiry)
    refresh_expires_at INTEGER,             -- Unix ms (refresh token expiry)
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    user_agent TEXT,
    ip_hash TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_sessions_refresh_expires ON user_sessions(refresh_expires_at);

-- Comptes OAuth liés (remplace/étend platform_accounts)
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,                 -- 'steam' | 'discord' | 'psn'
    provider_user_id TEXT NOT NULL,         -- ID côté provider (steamid64, discord user id, psn id)
    
    -- Tokens chiffrés
    access_token_enc TEXT,                  -- Access token (chiffré AES-256-GCM)
    refresh_token_enc TEXT,                 -- Refresh token (si dispo)
    id_token_enc TEXT,                      -- ID token OIDC (JWT)
    
    -- Métadonnées tokens
    token_expires_at INTEGER,               -- Expiration access token (Unix ms)
    refresh_expires_at INTEGER,             -- Expiration refresh token (Unix ms)
    scope TEXT,                             -- Scopes accordés (space-separated)
    token_type TEXT DEFAULT 'Bearer',
    
    -- Profil provider (dénormalisé pour affichage rapide)
    email TEXT,
    username TEXT,                          -- username/handle côté provider
    display_name TEXT,                      -- Nom affiché
    avatar_url TEXT,
    profile_url TEXT,
    country_code TEXT,                      -- Code pays (ex: FR, US)
    
    -- État
    is_primary INTEGER DEFAULT 0,           -- Compte principal pour ce provider
    linked_at INTEGER NOT NULL,
    last_synced_at INTEGER,
    sync_status TEXT DEFAULT 'pending',     -- 'pending', 'syncing', 'completed', 'failed'
    sync_error TEXT,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, provider),             -- Un compte par provider/user
    UNIQUE (provider, provider_user_id)     -- Un user local par provider ID
);
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_provider ON oauth_accounts(provider, provider_user_id);

-- Mettre à jour users pour email vérifié + password hash (fallback local)
-- Note: SQLite ne supporte pas ALTER TABLE ADD COLUMN IF NOT EXISTS avant 3.35
-- On utilise une approche compatible
-- Ces colonnes existent peut-être déjà, on ignore l'erreur si elles existent

-- Email vérifié
-- ALTER TABLE users ADD COLUMN email TEXT;
-- ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
-- Password hash pour auth locale (fallback)
-- ALTER TABLE users ADD COLUMN password_hash TEXT;
-- ALTER TABLE users ADD COLUMN last_login_at INTEGER;

-- Index pour lookup par email
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);