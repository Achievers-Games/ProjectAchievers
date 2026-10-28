use crate::{
    crypto::Crypto,
    database::{Database, UserSession},
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct SessionTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_at: i64,
    pub refresh_expires_at: i64,
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct SessionInfo {
    pub session_id: String,
    pub user_id: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub expires_at: i64,
    pub user_agent: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct RefreshResult {
    pub access_token: String,
    pub access_expires_at: i64,
}

/// Creates a new user session and returns JWT tokens
#[tauri::command]
#[specta::specta]
pub async fn create_session(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
    user_agent: Option<String>,
) -> AppResult<SessionTokens> {
    let user_id = db.get_current_user_id().await?;

    let session_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    let access_token = crypto.create_access_token(&user_id, &session_id)?;
    let refresh_token = crypto.create_refresh_token(&user_id, &session_id)?;

    let access_expires_at = now + 15 * 60 * 1000; // 15 minutes
    let refresh_expires_at = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    // Hash tokens for storage (SHA-256)
    let token_hash = hash_token(&access_token);
    let refresh_token_hash = hash_token(&refresh_token);

    let session = UserSession {
        id: session_id.clone(),
        user_id: user_id.clone(),
        token_hash,
        refresh_token_hash: Some(refresh_token_hash),
        expires_at: access_expires_at,
        refresh_expires_at: Some(refresh_expires_at),
        created_at: now,
        last_used_at: Some(now),
        user_agent,
        ip_hash: None, // Could be filled from request context
    };

    db.create_session(&session).await?;

    Ok(SessionTokens {
        access_token,
        refresh_token,
        access_expires_at,
        refresh_expires_at,
        session_id,
    })
}

/// Validates an access token and returns session info
#[tauri::command]
#[specta::specta]
pub async fn validate_session(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
    access_token: String,
) -> AppResult<SessionInfo> {
    let claims = crypto.validate_access_token(&access_token)?;

    // Verify session exists and matches
    let session = db.get_session_by_token_hash(&hash_token(&access_token)).await?
        .ok_or_else(|| AppError::Unauthorized("Session not found or expired".into()))?;

    // Check if session belongs to the same user
    if session.user_id != claims.sub {
        return Err(AppError::Unauthorized("Session user mismatch".into()));
    }

    // Update last_used_at
    db.update_session_last_used(&session.id, Utc::now().timestamp_millis()).await?;

    Ok(SessionInfo {
        session_id: session.id,
        user_id: session.user_id,
        created_at: session.created_at,
        last_used_at: session.last_used_at,
        expires_at: session.expires_at,
        user_agent: session.user_agent,
    })
}

/// Refreshes an access token using a refresh token
#[tauri::command]
#[specta::specta]
pub async fn refresh_session(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
    refresh_token: String,
) -> AppResult<RefreshResult> {
    let claims = crypto.validate_refresh_token(&refresh_token)?;

    // Verify session exists and matches
    let session = db.get_session_by_refresh_hash(&hash_token(&refresh_token)).await?
        .ok_or_else(|| AppError::Unauthorized("Session not found or expired".into()))?;

    // Check if session belongs to the same user
    if session.user_id != claims.sub {
        return Err(AppError::Unauthorized("Session user mismatch".into()));
    }

    // Check if refresh token is expired
    let now_ms = Utc::now().timestamp_millis();
    if session.refresh_expires_at.unwrap_or(0) < now_ms {
        // Delete expired session
        db.delete_session(&session.id).await?;
        return Err(AppError::Unauthorized("Refresh token expired".into()));
    }

    // Create new access token (rotate)
    let new_access_token = crypto.create_access_token(&claims.sub, &claims.sid)?;
    let new_access_expires_at = now_ms + 15 * 60 * 1000;

    // Update session with new access token hash
    let new_token_hash = hash_token(&new_access_token);
    db.update_session_token(&session.id, new_token_hash, new_access_expires_at).await?;

    // Update last_used_at
    db.update_session_last_used(&session.id, now_ms).await?;

    Ok(RefreshResult {
        access_token: new_access_token,
        access_expires_at: new_access_expires_at,
    })
}

/// Revokes (deletes) a session
#[tauri::command]
#[specta::specta]
pub async fn revoke_session(
    db: State<'_, Database>,
    session_id: String,
) -> AppResult<()> {
    let user_id = db.get_current_user_id().await?;

    // Verify ownership
    let session = db.get_session(&session_id).await?
        .ok_or_else(|| AppError::NotFound("Session not found".into()))?;

    if session.user_id != user_id {
        return Err(AppError::Unauthorized("Not authorized to revoke this session".into()));
    }

    db.delete_session(&session_id).await?;
    Ok(())
}

/// Revokes all sessions for the current user except the current one
#[tauri::command]
#[specta::specta]
pub async fn revoke_other_sessions(
    db: State<'_, Database>,
    current_session_id: String,
) -> AppResult<u64> {
    let user_id = db.get_current_user_id().await?;
    let count = db.delete_other_sessions(&user_id, &current_session_id).await?;
    Ok(count)
}

/// Gets all active sessions for the current user
#[tauri::command]
#[specta::specta]
pub async fn get_sessions(
    db: State<'_, Database>,
) -> AppResult<Vec<SessionInfo>> {
    let user_id = db.get_current_user_id().await?;
    let sessions = db.get_user_sessions(&user_id).await?;

    Ok(sessions.into_iter().map(|s| SessionInfo {
        session_id: s.id,
        user_id: s.user_id,
        created_at: s.created_at,
        last_used_at: s.last_used_at,
        expires_at: s.expires_at,
        user_agent: s.user_agent,
    }).collect())
}

fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}