use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use tauri::Manager;
use std::path::PathBuf;
use anyhow::Result;
use tracing::info;
use uuid::Uuid;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct OAuthAccount {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub provider_user_id: String,
    pub access_token_enc: Option<String>,
    pub refresh_token_enc: Option<String>,
    pub id_token_enc: Option<String>,
    pub token_expires_at: Option<i64>,
    pub refresh_expires_at: Option<i64>,
    pub scope: Option<String>,
    pub token_type: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
    pub country_code: Option<String>,
    pub is_primary: bool,
    pub linked_at: i64,
    pub last_synced_at: Option<i64>,
    pub sync_status: String,
    pub sync_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UserSession {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub refresh_token_hash: Option<String>,
    pub expires_at: i64,
    pub refresh_expires_at: Option<i64>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub user_agent: Option<String>,
    pub ip_hash: Option<String>,
}

pub struct Database {
    pub pool: SqlitePool,
}

impl Database {
    pub async fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let db_path = Self::get_db_path(app_handle)?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let database_url = format!("sqlite://{}?mode=rwc", db_path.display());
        info!("Connecting to database at: {}", database_url);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_lazy(&database_url)?;

        let db = Self { pool };
        db.run_migrations().await?;
        db.ensure_local_user().await?;

        Ok(db)
    }

    fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
        // Use tauri's app data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

        Ok(app_data_dir.join("project-achievers.db"))
    }

    async fn run_migrations(&self) -> Result<()> {
        // Run embedded migrations
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        info!("Database migrations completed");
        Ok(())
    }

    /// First launch has no account yet. Create a local profile so the app is
    /// usable offline; linking Steam later reuses this profile instead of
    /// creating a duplicate hunter.
    async fn ensure_local_user(&self) -> Result<()> {
        let row = sqlx::query("SELECT COUNT(*) AS count FROM users")
            .fetch_one(&self.pool)
            .await?;
        let count: i64 = row.get("count");

        if count == 0 {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO users (id, username, display_name, created_at, updated_at) \
                 VALUES (?, 'Chasseur', 'Chasseur local', ?, ?)",
            )
            .bind(&id)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
            info!("Created local profile (no linked platform yet)");
        }

        Ok(())
    }

    // ─── OAuth Accounts ───

    /// Link an OAuth account to the current user
    pub async fn link_oauth_account(
        &self,
        _user_id: &str,
        account: &OAuthAccount,
    ) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            r#"
            INSERT INTO oauth_accounts (
                id, user_id, provider, provider_user_id,
                access_token_enc, refresh_token_enc, id_token_enc,
                token_expires_at, refresh_expires_at, scope, token_type,
                email, username, display_name, avatar_url, profile_url, country_code,
                is_primary, linked_at, last_synced_at, sync_status, sync_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                provider_user_id = excluded.provider_user_id,
                access_token_enc = excluded.access_token_enc,
                refresh_token_enc = excluded.refresh_token_enc,
                id_token_enc = excluded.id_token_enc,
                token_expires_at = excluded.token_expires_at,
                refresh_expires_at = excluded.refresh_expires_at,
                scope = excluded.scope,
                token_type = excluded.token_type,
                email = excluded.email,
                username = excluded.username,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url,
                profile_url = excluded.profile_url,
                country_code = excluded.country_code,
                last_synced_at = excluded.last_synced_at,
                sync_status = excluded.sync_status,
                sync_error = excluded.sync_error
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&account.user_id)
        .bind(&account.provider)
        .bind(&account.provider_user_id)
        .bind(&account.access_token_enc)
        .bind(&account.refresh_token_enc)
        .bind(&account.id_token_enc)
        .bind(account.token_expires_at)
        .bind(account.refresh_expires_at)
        .bind(&account.scope)
        .bind(&account.token_type)
        .bind(&account.email)
        .bind(&account.username)
        .bind(&account.display_name)
        .bind(&account.avatar_url)
        .bind(&account.profile_url)
        .bind(&account.country_code)
        .bind(if account.is_primary { 1 } else { 0 })
        .bind(now)
        .bind(account.last_synced_at)
        .bind(&account.sync_status)
        .bind(&account.sync_error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Get all linked OAuth accounts for a user
    pub async fn get_oauth_accounts(&self, user_id: &str) -> Result<Vec<OAuthAccount>> {
        let rows = sqlx::query(
            "SELECT * FROM oauth_accounts WHERE user_id = ? ORDER BY linked_at DESC"
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let accounts = rows
            .into_iter()
            .map(|row| OAuthAccount {
                id: row.get("id"),
                user_id: row.get("user_id"),
                provider: row.get("provider"),
                provider_user_id: row.get("provider_user_id"),
                access_token_enc: row.get("access_token_enc"),
                refresh_token_enc: row.get("refresh_token_enc"),
                id_token_enc: row.get("id_token_enc"),
                token_expires_at: row.get("token_expires_at"),
                refresh_expires_at: row.get("refresh_expires_at"),
                scope: row.get("scope"),
                token_type: row.get("token_type"),
                email: row.get("email"),
                username: row.get("username"),
                display_name: row.get("display_name"),
                avatar_url: row.get("avatar_url"),
                profile_url: row.get("profile_url"),
                country_code: row.get("country_code"),
                is_primary: row.get::<i64, _>("is_primary") != 0,
                linked_at: row.get("linked_at"),
                last_synced_at: row.get("last_synced_at"),
                sync_status: row.get("sync_status"),
                sync_error: row.get("sync_error"),
            })
            .collect();
        Ok(accounts)
    }

    /// Get a specific OAuth account by provider
    pub async fn get_oauth_account(
        &self,
        user_id: &str,
        provider: &str,
    ) -> Result<Option<OAuthAccount>> {
        let row = sqlx::query("SELECT * FROM oauth_accounts WHERE user_id = ? AND provider = ?")
            .bind(user_id)
            .bind(provider)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| OAuthAccount {
            id: row.get("id"),
            user_id: row.get("user_id"),
            provider: row.get("provider"),
            provider_user_id: row.get("provider_user_id"),
            access_token_enc: row.get("access_token_enc"),
            refresh_token_enc: row.get("refresh_token_enc"),
            id_token_enc: row.get("id_token_enc"),
            token_expires_at: row.get("token_expires_at"),
            refresh_expires_at: row.get("refresh_expires_at"),
            scope: row.get("scope"),
            token_type: row.get("token_type"),
            email: row.get("email"),
            username: row.get("username"),
            display_name: row.get("display_name"),
            avatar_url: row.get("avatar_url"),
            profile_url: row.get("profile_url"),
            country_code: row.get("country_code"),
            is_primary: row.get::<i64, _>("is_primary") != 0,
            linked_at: row.get("linked_at"),
            last_synced_at: row.get("last_synced_at"),
            sync_status: row.get("sync_status"),
            sync_error: row.get("sync_error"),
        }))
    }

    /// Unlink an OAuth account
    pub async fn unlink_oauth_account(&self, user_id: &str, provider: &str) -> Result<bool> {
        let result = sqlx::query(
            "DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?"
        )
        .bind(user_id)
        .bind(provider)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Set primary OAuth account for a provider
    pub async fn set_primary_oauth_account(&self, user_id: &str, provider: &str) -> Result<()> {
        sqlx::query(
            "UPDATE oauth_accounts SET is_primary = 0 WHERE user_id = ? AND provider = ?"
        )
        .bind(user_id)
        .bind(provider)
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "UPDATE oauth_accounts SET is_primary = 1 WHERE user_id = ? AND provider = ?"
        )
        .bind(user_id)
        .bind(provider)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Update OAuth account tokens
    pub async fn update_oauth_tokens(
        &self,
        user_id: &str,
        provider: &str,
        access_token_enc: Option<String>,
        refresh_token_enc: Option<String>,
        id_token_enc: Option<String>,
        token_expires_at: Option<i64>,
        refresh_expires_at: Option<i64>,
        scope: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE oauth_accounts SET
                access_token_enc = COALESCE(?, access_token_enc),
                refresh_token_enc = COALESCE(?, refresh_token_enc),
                id_token_enc = COALESCE(?, id_token_enc),
                token_expires_at = COALESCE(?, token_expires_at),
                refresh_expires_at = COALESCE(?, refresh_expires_at),
                scope = COALESCE(?, scope),
                last_synced_at = ?,
                sync_status = 'completed',
                sync_error = NULL
            WHERE user_id = ? AND provider = ?
            "#,
        )
        .bind(access_token_enc)
        .bind(refresh_token_enc)
        .bind(id_token_enc)
        .bind(token_expires_at)
        .bind(refresh_expires_at)
        .bind(scope)
        .bind(Utc::now().timestamp_millis())
        .bind(user_id)
        .bind(provider)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Update OAuth account sync status
    pub async fn update_oauth_sync_status(
        &self,
        user_id: &str,
        provider: &str,
        status: &str,
        error: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE oauth_accounts SET sync_status = ?, sync_error = ? WHERE user_id = ? AND provider = ?"
        )
        .bind(status)
        .bind(error)
        .bind(user_id)
        .bind(provider)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ─── User Sessions ───

    /// Get session by token hash
    pub async fn get_session_by_token_hash(&self, token_hash: &str) -> Result<Option<UserSession>> {
        let row = sqlx::query("SELECT * FROM user_sessions WHERE token_hash = ?")
            .bind(token_hash)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| UserSession {
            id: row.get("id"),
            user_id: row.get("user_id"),
            token_hash: row.get("token_hash"),
            refresh_token_hash: row.get("refresh_token_hash"),
            expires_at: row.get("expires_at"),
            refresh_expires_at: row.get("refresh_expires_at"),
            created_at: row.get("created_at"),
            last_used_at: row.get("last_used_at"),
            user_agent: row.get("user_agent"),
            ip_hash: row.get("ip_hash"),
        }))
    }

    /// Get session by refresh token hash
    pub async fn get_session_by_refresh_hash(&self, refresh_hash: &str) -> Result<Option<UserSession>> {
        let row = sqlx::query("SELECT * FROM user_sessions WHERE refresh_token_hash = ?")
            .bind(refresh_hash)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| UserSession {
            id: row.get("id"),
            user_id: row.get("user_id"),
            token_hash: row.get("token_hash"),
            refresh_token_hash: row.get("refresh_token_hash"),
            expires_at: row.get("expires_at"),
            refresh_expires_at: row.get("refresh_expires_at"),
            created_at: row.get("created_at"),
            last_used_at: row.get("last_used_at"),
            user_agent: row.get("user_agent"),
            ip_hash: row.get("ip_hash"),
        }))
    }

    /// Update session access token hash and expiry
    pub async fn update_session_token(&self, session_id: &str, token_hash: String, expires_at: i64) -> Result<()> {
        sqlx::query(
            "UPDATE user_sessions SET token_hash = ?, expires_at = ? WHERE id = ?"
        )
        .bind(token_hash)
        .bind(expires_at)
        .bind(session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Update session last used timestamp
    pub async fn update_session_last_used(&self, session_id: &str, last_used_at: i64) -> Result<()> {
        sqlx::query(
            "UPDATE user_sessions SET last_used_at = ? WHERE id = ?"
        )
        .bind(last_used_at)
        .bind(session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Revoke a session (logout)
    pub async fn revoke_session(&self, session_id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM user_sessions WHERE id = ?")
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Revoke all sessions for a user (logout everywhere)
    pub async fn revoke_all_sessions(&self, user_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM user_sessions WHERE user_id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Clean expired sessions
    pub async fn clean_expired_sessions(&self) -> Result<u64> {
        let now = Utc::now().timestamp_millis();
        let result = sqlx::query("DELETE FROM user_sessions WHERE expires_at < ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Get session by ID
    pub async fn get_session(&self, session_id: &str) -> Result<Option<UserSession>> {
        let row = sqlx::query("SELECT * FROM user_sessions WHERE id = ?")
            .bind(session_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| UserSession {
            id: row.get("id"),
            user_id: row.get("user_id"),
            token_hash: row.get("token_hash"),
            refresh_token_hash: row.get("refresh_token_hash"),
            expires_at: row.get("expires_at"),
            refresh_expires_at: row.get("refresh_expires_at"),
            created_at: row.get("created_at"),
            last_used_at: row.get("last_used_at"),
            user_agent: row.get("user_agent"),
            ip_hash: row.get("ip_hash"),
        }))
    }

    /// Get all sessions for a user
    pub async fn get_user_sessions(&self, user_id: &str) -> Result<Vec<UserSession>> {
        let rows = sqlx::query("SELECT * FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.into_iter().map(|row| UserSession {
            id: row.get("id"),
            user_id: row.get("user_id"),
            token_hash: row.get("token_hash"),
            refresh_token_hash: row.get("refresh_token_hash"),
            expires_at: row.get("expires_at"),
            refresh_expires_at: row.get("refresh_expires_at"),
            created_at: row.get("created_at"),
            last_used_at: row.get("last_used_at"),
            user_agent: row.get("user_agent"),
            ip_hash: row.get("ip_hash"),
        }).collect())
    }

    /// Delete a specific session
    pub async fn delete_session(&self, session_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM user_sessions WHERE id = ?")
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Delete all other sessions for a user except the current one
    pub async fn delete_other_sessions(&self, user_id: &str, current_session_id: &str) -> Result<u64> {
        let result = sqlx::query("DELETE FROM user_sessions WHERE user_id = ? AND id != ?")
            .bind(user_id)
            .bind(current_session_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Create a new user session
    pub async fn create_session(
        &self,
        session: &UserSession,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO user_sessions (
                id, user_id, token_hash, refresh_token_hash,
                expires_at, refresh_expires_at, created_at, last_used_at,
                user_agent, ip_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&session.id)
        .bind(&session.user_id)
        .bind(&session.token_hash)
        .bind(&session.refresh_token_hash)
        .bind(session.expires_at)
        .bind(session.refresh_expires_at)
        .bind(session.created_at)
        .bind(session.last_used_at)
        .bind(&session.user_agent)
        .bind(&session.ip_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn get_user_by_email(&self, email: &str) -> Result<Option<(String, String)>> {
        let row = sqlx::query("SELECT id, password_hash FROM users WHERE email = ?")
            .bind(email)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| (row.get("id"), row.get("password_hash"))))
    }

    /// Create local user with password
    pub async fn create_local_user(
        &self,
        username: &str,
        email: &str,
        password_hash: &str,
    ) -> Result<String> {
        let user_id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();

        sqlx::query(
            "INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&user_id)
        .bind(username)
        .bind(email)
        .bind(password_hash)
        .bind(username)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(user_id)
    }

    /// Get the current user ID (single-user app: first user)
    pub async fn get_current_user_id(&self) -> Result<String> {
        let row = sqlx::query("SELECT id FROM users LIMIT 1")
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("No user found"))?;

        Ok(row.get("id"))
    }
}