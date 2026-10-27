use crate::{
    database::Database,
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct LinkedAccount {
    pub id: String,
    pub platform: String,
    pub platform_user_id: String,
    pub platform_username: Option<String>,
    pub avatar_url: Option<String>,
    pub last_synced_at: Option<i64>,
    pub sync_status: String,
    pub sync_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub linked_accounts: Vec<LinkedAccount>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SteamAuthRequest {
    pub steam_id: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct PsnAuthRequest {
    pub npsso: String,
}

/// Authenticate with Steam using Steam ID and optional API key
#[tauri::command]
#[specta::specta]
pub async fn authenticate_steam(
    request: SteamAuthRequest,
    db: State<'_, Database>,
    crypto: State<'_, crate::crypto::Crypto>,
) -> AppResult<LinkedAccount> {
    // Validate Steam ID format (64-bit Steam ID)
    if request.steam_id.len() != 17 || !request.steam_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation("Invalid Steam ID format".to_string()));
    }

    // Verify the Steam ID works by calling GetPlayerSummaries
    let client = reqwest::Client::new();
    // API key provided inline, or fall back to the user's stored (encrypted) key.
    let api_key = match &request.api_key {
        Some(k) if !k.is_empty() => k.clone(),
        _ => std::env::var("STEAM_API_KEY").unwrap_or_default(),
    };
    let url = format!(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={}&steamids={}",
        api_key, request.steam_id
    );

    let response = client.get(&url).send().await?;
    let data: serde_json::Value = response.json().await?;

    let player = data["response"]["players"][0].as_object()
        .ok_or_else(|| AppError::NotFound("Steam ID not found".to_string()))?;

    let persona_name = player["personaname"].as_str().unwrap_or("Unknown").to_string();
    let avatar_url = player["avatarfull"].as_str().map(|s| s.to_string());

    // Get or create user
    let user_id = get_or_create_user(&db, &persona_name).await?;

    // Encrypt API key if provided
    let encrypted_api_key = if let Some(key) = request.api_key {
        Some(crypto.encrypt(&key)?)
    } else {
        None
    };

    // Store platform account
    let account_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO platform_accounts (id, user_id, platform, platform_user_id, platform_username, avatar_url, encrypted_access_token, last_synced_at, sync_status)
        VALUES (?, ?, 'steam', ?, ?, ?, ?, ?, 'pending')
        ON CONFLICT(user_id, platform) DO UPDATE SET
            platform_user_id = excluded.platform_user_id,
            platform_username = excluded.platform_username,
            avatar_url = excluded.avatar_url,
            encrypted_access_token = excluded.encrypted_access_token,
            updated_at = strftime('%s', 'now') * 1000
        "#,
    )
    .bind(&account_id)
    .bind(&user_id)
    .bind(&request.steam_id)
    .bind(&persona_name)
    .bind(&avatar_url)
    .bind(&encrypted_api_key)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    Ok(LinkedAccount {
        id: account_id,
        platform: "steam".to_string(),
        platform_user_id: request.steam_id,
        platform_username: Some(persona_name),
        avatar_url,
        last_synced_at: Some(now),
        sync_status: "pending".to_string(),
        sync_error: None,
    })
}

/// Authenticate with PSN using NPSSO token
#[tauri::command]
#[specta::specta]
pub async fn authenticate_psn(
    request: PsnAuthRequest,
    db: State<'_, Database>,
    crypto: State<'_, crate::crypto::Crypto>,
) -> AppResult<LinkedAccount> {
    // Validate NPSSO token format
    if request.npsso.is_empty() {
        return Err(AppError::Validation("NPSSO token is required".to_string()));
    }

    // Verify the NPSSO token by calling PSN API
    // Note: PSN doesn't have a public API, we use the PSNProfiles approach
    // This is a simplified version - in production you'd use the proper PSN API
    let client = reqwest::Client::new();
    let url = "https://m.np.playstation.com/api/graphql/v1/op/me";

    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {}", request.npsso))
        .send()
        .await;

    let (psn_id, psn_username, avatar_url) = match response {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await?;
            let profile = data["data"]["me"]["profile"].as_object().ok_or_else(|| {
                anyhow::anyhow!("Invalid PSN response")
            })?;
            let psn_id = profile["onlineId"].as_str().unwrap_or("").to_string();
            let psn_username = profile["onlineId"].as_str().unwrap_or("Unknown").to_string();
            let avatar_url = profile["avatarUrls"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v["url"].as_str())
                .map(|s| s.to_string());
            (psn_id, psn_username, avatar_url)
        }
        _ => {
            // Fallback: use PSNProfiles API or manual entry
            return Err(AppError::PsnApi("Failed to authenticate with PSN. PSN API access is limited.".to_string()));
        }
    };

    // Get or create user
    let user_id = get_or_create_user(&db, &psn_username).await?;

    // Encrypt NPSSO token
    let encrypted_npsso = crypto.encrypt(&request.npsso)?;

    let account_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO platform_accounts (id, user_id, platform, platform_user_id, platform_username, avatar_url, encrypted_access_token, last_synced_at, sync_status)
        VALUES (?, ?, 'psn', ?, ?, ?, ?, ?, 'pending')
        ON CONFLICT(user_id, platform) DO UPDATE SET
            platform_user_id = excluded.platform_user_id,
            platform_username = excluded.platform_username,
            avatar_url = excluded.avatar_url,
            encrypted_access_token = excluded.encrypted_access_token,
            updated_at = strftime('%s', 'now') * 1000
        "#,
    )
    .bind(&account_id)
    .bind(&user_id)
    .bind(&psn_id)
    .bind(&psn_username)
    .bind(&avatar_url)
    .bind(&encrypted_npsso)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    Ok(LinkedAccount {
        id: account_id,
        platform: "psn".to_string(),
        platform_user_id: psn_id,
        platform_username: Some(psn_username),
        avatar_url,
        last_synced_at: Some(now),
        sync_status: "pending".to_string(),
        sync_error: None,
    })
}

/// Get all linked accounts for the current user
#[tauri::command]
#[specta::specta]
pub async fn get_linked_accounts(
    db: State<'_, Database>,
) -> AppResult<Vec<LinkedAccount>> {
    let user_id = get_current_user_id(&db).await?;

    let rows = sqlx::query(
        r#"
        SELECT id, platform, platform_user_id, platform_username, avatar_url, last_synced_at, sync_status, sync_error
        FROM platform_accounts
        WHERE user_id = ?
        "#,
    )
    .bind(&user_id)
    .fetch_all(&db.pool)
    .await?;

    let accounts = rows
        .into_iter()
        .map(|row| LinkedAccount {
            id: row.get("id"),
            platform: row.get("platform"),
            platform_user_id: row.get("platform_user_id"),
            platform_username: row.get("platform_username"),
            avatar_url: row.get("avatar_url"),
            last_synced_at: row.get("last_synced_at"),
            sync_status: row.get("sync_status"),
            sync_error: row.get("sync_error"),
        })
        .collect();

    Ok(accounts)
}

/// Unlink a platform account
#[tauri::command]
#[specta::specta]
pub async fn unlink_account(
    account_id: String,
    db: State<'_, Database>,
) -> AppResult<()> {
    let user_id = get_current_user_id(&db).await?;

    let result = sqlx::query(
        "DELETE FROM platform_accounts WHERE id = ? AND user_id = ?"
    )
    .bind(&account_id)
    .bind(&user_id)
    .execute(&db.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("Account not found").into());
    }

    Ok(())
}

/// Get authentication status
#[tauri::command]
#[specta::specta]
pub async fn get_auth_status(
    db: State<'_, Database>,
) -> AppResult<AuthStatus> {
    // Check if there's a current user session
    let user_id = get_current_user_id(&db).await.ok();

    if let Some(uid) = user_id {
        let user_row = sqlx::query("SELECT id, username FROM users WHERE id = ?")
            .bind(&uid)
            .fetch_optional(&db.pool)
            .await?;

        if let Some(row) = user_row {
            let accounts = get_linked_accounts(db).await?;
            return Ok(AuthStatus {
                is_authenticated: true,
                user_id: Some(row.get("id")),
                username: Some(row.get("username")),
                linked_accounts: accounts,
            });
        }
    }

    Ok(AuthStatus {
        is_authenticated: false,
        user_id: None,
        username: None,
        linked_accounts: vec![],
    })
}

async fn get_or_create_user(db: &Database, username: &str) -> AppResult<String> {
    // Try to find existing user
    let existing = sqlx::query("SELECT id FROM users WHERE username = ?")
        .bind(username)
        .fetch_optional(&db.pool)
        .await?;

    if let Some(row) = existing {
        return Ok(row.get("id"));
    }

    // Reuse the local first-launch profile instead of leaving an orphan hunter
    // behind in the leaderboard.
    let orphan = sqlx::query(
        "SELECT u.id FROM users u \
         WHERE NOT EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = u.id) \
         LIMIT 1",
    )
    .fetch_optional(&db.pool)
    .await?;

    if let Some(row) = orphan {
        let user_id: String = row.get("id");
        sqlx::query("UPDATE users SET username = ?, updated_at = ? WHERE id = ?")
            .bind(username)
            .bind(Utc::now().timestamp_millis())
            .bind(&user_id)
            .execute(&db.pool)
            .await?;
        return Ok(user_id);
    }

    // Create new user
    let user_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)"
    )
    .bind(&user_id)
    .bind(username)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    Ok(user_id)
}

async fn get_current_user_id(db: &Database) -> AppResult<String> {
    // In a real app, this would come from session/auth state
    // For now, get the first user (single-user app assumption)
    let row = sqlx::query("SELECT id FROM users LIMIT 1")
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Internal("No user found. Please link an account first.".to_string()))?;

    Ok(row.get("id"))
}