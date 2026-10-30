use crate::{
    crypto::Crypto,
    database::Database,
    error::{AppError, AppResult, AuthResult},
};
use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::Row;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;
use reqwest::Client;
use urlencoding::encode;
use std::collections::HashMap;

/// Steam OpenID response parameters
#[derive(Debug, Deserialize, Serialize, Type)]
pub struct SteamOpenIdParams {
    #[serde(rename = "openid.ns")]
    pub ns: Option<String>,
    #[serde(rename = "openid.mode")]
    pub mode: Option<String>,
    #[serde(rename = "openid.op_endpoint")]
    pub op_endpoint: Option<String>,
    #[serde(rename = "openid.claimed_id")]
    pub claimed_id: Option<String>,
    #[serde(rename = "openid.identity")]
    pub identity: Option<String>,
    #[serde(rename = "openid.return_to")]
    pub return_to: Option<String>,
    #[serde(rename = "openid.response_nonce")]
    pub response_nonce: Option<String>,
    #[serde(rename = "openid.assoc_handle")]
    pub assoc_handle: Option<String>,
    #[serde(rename = "openid.signed")]
    pub signed: Option<String>,
    #[serde(rename = "openid.sig")]
    pub sig: Option<String>,
}

/// Helper to get env var with proper error conversion
fn env_var(key: &str) -> AppResult<String> {
    std::env::var(key).map_err(|_| AppError::Internal(format!("{} not configured", key)))
}

/// Génère l'URL d'autorisation Steam OpenID 2.0
#[tauri::command]
#[specta::specta]
pub async fn steam_openid_url(state: String) -> AppResult<String> {
    let realm = env_var("STEAM_OPENID_REALM")
        .map_err(|_| AppError::Internal("STEAM_OPENID_REALM not configured".into()))?;
    let return_to = env_var("STEAM_OPENID_RETURN_TO")
        .map_err(|_| AppError::Internal("STEAM_OPENID_RETURN_TO not configured".into()))?;

    let url = format!(
        "https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.mode=checkid_setup&openid.return_to={}&openid.realm={}&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.state={}",
        encode(&return_to),
        encode(&realm),
        encode(&state)
    );
    Ok(url)
}

/// Callback Steam OpenID 2.0 - vérifie la réponse OpenID et lie le compte
#[tauri::command]
#[specta::specta]
pub async fn steam_openid_callback(
    openid_params: SteamOpenIdParams,
    state: String,
    db: State<'_, Database>,
    _crypto: State<'_, Crypto>,
) -> AppResult<AuthResult> {
    // Validate state (CSRF protection)
    // In a real implementation, you'd verify the state against a stored value
    // For now, we just ensure it's present
    if state.is_empty() {
        return Err(AppError::Validation("Invalid OpenID state".into()));
    }

    // Convert struct to HashMap for verification
    let mut params = HashMap::new();
    if let Some(v) = openid_params.ns { params.insert("openid.ns".to_string(), v); }
    if let Some(v) = openid_params.mode { params.insert("openid.mode".to_string(), v); }
    if let Some(v) = openid_params.op_endpoint { params.insert("openid.op_endpoint".to_string(), v); }
    if let Some(v) = openid_params.claimed_id { params.insert("openid.claimed_id".to_string(), v); }
    if let Some(v) = openid_params.identity { params.insert("openid.identity".to_string(), v); }
    if let Some(v) = openid_params.return_to { params.insert("openid.return_to".to_string(), v); }
    if let Some(v) = openid_params.response_nonce { params.insert("openid.response_nonce".to_string(), v); }
    if let Some(v) = openid_params.assoc_handle { params.insert("openid.assoc_handle".to_string(), v); }
    if let Some(v) = openid_params.signed { params.insert("openid.signed".to_string(), v); }
    if let Some(v) = openid_params.sig { params.insert("openid.sig".to_string(), v); }

    // The claimed_id must be present and contain the Steam ID
    let claimed_id = params.get("openid.claimed_id")
        .ok_or_else(|| AppError::Validation("Missing openid.claimed_id".into()))?;

    // Extract SteamID64 from claimed_id (format: http://steamcommunity.com/openid/id/7656119XXXXXXXXXX)
    let steam_id = extract_steam_id(claimed_id)
        .ok_or_else(|| AppError::Validation("Invalid Steam ID in claimed_id".into()))?;

    // Verify the OpenID response with Steam
    verify_openid_response(&params).await?;

    // Get user profile from Steam Web API
    let client = Client::new();
    let api_key = std::env::var("STEAM_API_KEY").unwrap_or_default();

    let user_summary = if !api_key.is_empty() {
        let url = format!(
            "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={}&steamids={}",
            api_key, steam_id
        );
        let resp: serde_json::Value = client.get(&url).send().await?.json().await?;
        resp["response"]["players"][0].clone()
    } else {
        // Fallback: minimal info from claimed_id
        serde_json::json!({
            "steamid": steam_id,
            "personaname": "Steam User",
            "avatarfull": "",
            "profileurl": format!("https://steamcommunity.com/profiles/{}", steam_id)
        })
    };

    let steamid = user_summary["steamid"].as_str().unwrap_or(&steam_id).to_string();
    let personaname = user_summary["personaname"].as_str().unwrap_or("Steam User").to_string();
    let avatarfull = user_summary["avatarfull"].as_str().map(|s| s.to_string());
    let profileurl = user_summary["profileurl"].as_str().map(|s| s.to_string());

    // Check if Steam account is already linked
    let existing = sqlx::query(
        "SELECT user_id FROM oauth_accounts WHERE provider = 'steam' AND provider_user_id = ?"
    )
    .bind(&steamid)
    .fetch_optional(&db.pool)
    .await?;

    let (user_id, is_new_user) = if let Some(row) = existing {
        // Account already linked - login
        let uid: String = row.get("user_id");
        (uid, false)
    } else {
        // New account - create user + link
        let uid = get_or_create_user(&db, &personaname, Some(&steamid)).await?;
        (uid, true)
    };

    // Store the OpenID association (no access/refresh tokens for OpenID)
    // We store a marker in oauth_accounts to track the linked Steam account
    let oauth_account = crate::database::OAuthAccount {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.clone(),
        provider: "steam".to_string(),
        provider_user_id: steamid.clone(),
        access_token_enc: None, // OpenID doesn't have access tokens
        refresh_token_enc: None,
        id_token_enc: None,
        token_expires_at: None,
        refresh_expires_at: None,
        scope: Some("openid".to_string()),
        token_type: None,
        email: None,
        username: Some(steamid.clone()),
        display_name: Some(personaname.clone()),
        avatar_url: avatarfull.clone(),
        profile_url: profileurl,
        country_code: None,
        is_primary: true,
        linked_at: Utc::now().timestamp_millis(),
        last_synced_at: Some(Utc::now().timestamp_millis()),
        sync_status: "completed".to_string(),
        sync_error: None,
    };

    db.link_oauth_account(&user_id, &oauth_account).await?;

    // Mirror into platform_accounts for existing sync pipeline
    let now_ms = Utc::now().timestamp_millis();
    sqlx::query(
        r#"
        INSERT INTO platform_accounts (
            id, user_id, platform, platform_user_id, platform_username, avatar_url,
            last_synced_at, sync_status, sync_error, created_at, updated_at
        ) VALUES (?, ?, 'steam', ?, ?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(user_id, platform) DO UPDATE SET
            platform_user_id = excluded.platform_user_id,
            platform_username = excluded.platform_username,
            avatar_url = excluded.avatar_url,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&user_id)
    .bind(&steamid)
    .bind(&personaname)
    .bind(&avatarfull)
    .bind(now_ms)
    .bind(now_ms)
    .bind(now_ms)
    .execute(&db.pool)
    .await?;

    Ok(AuthResult {
        success: true,
        user_id,
        is_new_user,
        linked_account: Some(oauth_account),
    })
}

/// Récupère l'URL d'autorisation pour lier un compte Steam (depuis settings)
#[tauri::command]
#[specta::specta]
pub async fn steam_openid_link_url(state: String) -> AppResult<String> {
    steam_openid_url(state).await
}

/// Extrait le SteamID64 du claimed_id OpenID
fn extract_steam_id(claimed_id: &str) -> Option<String> {
    // Format: http://steamcommunity.com/openid/id/7656119XXXXXXXXXX
    const PREFIX: &str = "http://steamcommunity.com/openid/id/";
    if claimed_id.starts_with(PREFIX) {
        let id = &claimed_id[PREFIX.len()..];
        if id.len() == 17 && id.chars().all(|c| c.is_ascii_digit()) {
            return Some(id.to_string());
        }
    }
    None
}

/// Vérifie la réponse OpenID avec Steam
async fn verify_openid_response(params: &HashMap<String, String>) -> AppResult<()> {
    let client = Client::new();

    // Build verification request - send all params back with mode=check_authentication
    let mut verify_params = params.clone();
    verify_params.insert("openid.mode".to_string(), "check_authentication".to_string());

    let response = client
        .post("https://steamcommunity.com/openid/login")
        .form(&verify_params)
        .send()
        .await?;

    let body = response.text().await?;

    // Steam responds with "is_valid:true\n" or "is_valid:false\n"
    if !body.contains("is_valid:true") {
        return Err(AppError::Validation("OpenID verification failed".into()));
    }

    Ok(())
}

/// Get or create user (shared with other auth methods)
async fn get_or_create_user(
    db: &Database,
    username: &str,
    steam_id: Option<&str>,
) -> AppResult<String> {
    // Try to find existing user with this steam_id
    if let Some(sid) = steam_id {
        let existing = sqlx::query(
            "SELECT u.id FROM users u
             JOIN oauth_accounts oa ON oa.user_id = u.id
             WHERE oa.provider = 'steam' AND oa.provider_user_id = ?"
        )
        .bind(sid)
        .fetch_optional(&db.pool)
        .await?;

        if let Some(row) = existing {
            return Ok(row.get("id"));
        }
    }

    // Reuse orphan local profile if exists
    let orphan = sqlx::query(
        "SELECT u.id FROM users u
         WHERE NOT EXISTS (SELECT 1 FROM oauth_accounts oa WHERE oa.user_id = u.id)
         LIMIT 1"
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
        "INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&user_id)
    .bind(username)
    .bind(username)
    .bind(now)
    .bind(now)
    .execute(&db.pool)
    .await?;

    Ok(user_id)
}