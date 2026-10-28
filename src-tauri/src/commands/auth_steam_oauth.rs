use crate::{
    commands::oauth_flow::OAuthManager,
    crypto::Crypto,
    database::{Database, OAuthAccount},
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

const STEAM_API_BASE: &str = "https://api.steampowered.com";

/// Helper to get env var with proper error conversion
fn env_var(key: &str) -> AppResult<String> {
    std::env::var(key).map_err(|_| AppError::Internal(format!("{} not configured", key)))
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct SteamTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
    pub scope: String,
    pub id_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct SteamUserSummary {
    pub steamid: String,
    pub personaname: String,
    pub avatarfull: String,
    pub profileurl: String,
    pub email: Option<String>,
    pub loccountrycode: Option<String>,
}

/// Génère l'URL d'autorisation Steam OAuth 2.0
#[tauri::command]
#[specta::specta]
pub async fn steam_oauth_url(state: String) -> AppResult<String> {
    let client_id = env_var("STEAM_CLIENT_ID")
        .map_err(|_| AppError::Internal("STEAM_CLIENT_ID not configured".into()))?;
    let redirect_uri = env_var("STEAM_REDIRECT_URI")
        .map_err(|_| AppError::Internal("STEAM_REDIRECT_URI not configured".into()))?;
    let scopes = env_var("STEAM_SCOPES").unwrap_or_else(|_| "openid profile email".into());

    let url = format!(
        "https://steamcommunity.com/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        encode(&client_id),
        encode(&redirect_uri),
        encode(&scopes),
        encode(&state)
    );
    Ok(url)
}

/// Callback Steam OAuth 2.0 - échange le code contre les tokens et lie le compte
#[tauri::command]
#[specta::specta]
pub async fn steam_oauth_callback(
    code: String,
    state: String,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
    manager: State<'_, OAuthManager>,
) -> AppResult<AuthResult> {
    // Validate the CSRF state and retrieve the loopback redirect URI that was
    // registered with the provider when the flow started.
    let pending = manager.take(&state, "steam")?;

    let client_id = env_var("STEAM_CLIENT_ID")
        .map_err(|_| AppError::Internal("STEAM_CLIENT_ID not configured".into()))?;
    let client_secret = env_var("STEAM_CLIENT_SECRET")
        .map_err(|_| AppError::Internal("STEAM_CLIENT_SECRET not configured".into()))?;
    let redirect_uri = pending.redirect_uri;

    // 1. Échange le code contre les tokens
    let client = Client::new();
    let token_resp: SteamTokenResponse = client
        .post(format!("{}/oauth2/token", STEAM_API_BASE))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("redirect_uri", &redirect_uri),
        ])
        .send()
        .await?
        .json()
        .await?;

    // 2. Récupère le profil via access_token
    let user: SteamUserSummary = client
        .get(format!("{}/ISteamUser/GetPlayerSummaries/v2/", STEAM_API_BASE))
        .bearer_auth(&token_resp.access_token)
        .send()
        .await?
        .json()
        .await?;

    // 3. Vérifie si le compte Steam est déjà lié
    let existing = sqlx::query(
        "SELECT user_id FROM oauth_accounts WHERE provider = 'steam' AND provider_user_id = ?"
    )
    .bind(&user.steamid)
    .fetch_optional(&db.pool)
    .await?;

    let (user_id, is_new_user) = if let Some(row) = existing {
        // Compte déjà lié - connexion
        let uid: String = row.get("user_id");
        (uid, false)
    } else {
        // Nouveau compte - créer utilisateur + lier
        let uid = get_or_create_user(&db, &user.personaname, Some(&user.steamid)).await?;
        (uid, true)
    };

    // 4. Chiffre les tokens
    let access_token_enc = crypto.encrypt(&token_resp.access_token)?;
    let refresh_token_enc = crypto.encrypt(&token_resp.refresh_token)?;
    let id_token_enc = token_resp.id_token.map(|t| crypto.encrypt(&t)).transpose()?;

    let now = Utc::now().timestamp_millis();
    let token_expires_at = now + (token_resp.expires_in * 1000);

    // 5. Crée/met à jour le compte OAuth
    let oauth_account = OAuthAccount {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.clone(),
        provider: "steam".to_string(),
        provider_user_id: user.steamid.clone(),
        access_token_enc: Some(access_token_enc),
        refresh_token_enc: Some(refresh_token_enc),
        id_token_enc,
        token_expires_at: Some(token_expires_at),
        refresh_expires_at: Some(now + (30 * 24 * 60 * 60 * 1000)),
        scope: Some(token_resp.scope),
        token_type: Some(token_resp.token_type),
        email: user.email,
        username: Some(user.steamid.clone()),
        display_name: Some(user.personaname.clone()),
        avatar_url: Some(user.avatarfull.clone()),
        profile_url: Some(user.profileurl),
        country_code: user.loccountrycode,
        is_primary: true,
        linked_at: Utc::now().timestamp_millis(),
        last_synced_at: Some(Utc::now().timestamp_millis()),
        sync_status: "completed".to_string(),
        sync_error: None,
    };

    db.link_oauth_account(&user_id, &oauth_account).await?;

    // Mirror the account into platform_accounts so the existing library/sync
    // pipeline (which reads Steam IDs from platform_accounts) keeps working.
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
    .bind(&user.steamid)
    .bind(&user.personaname)
    .bind(&user.avatarfull)
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
pub async fn steam_oauth_link_url(state: String) -> AppResult<String> {
    steam_oauth_url(state).await
}

/// Rafraîchit le token d'accès Steam
#[tauri::command]
#[specta::specta]
pub async fn steam_refresh_token(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<()> {
    let user_id = db.get_current_user_id().await?;

    // Récupère le compte Steam
    let account = db.get_oauth_account(&user_id, "steam").await?
        .ok_or_else(|| AppError::NotFound("Steam account not linked".into()))?;

    let refresh_token = account.refresh_token_enc
        .and_then(|enc| crypto.decrypt(&enc).ok())
        .ok_or_else(|| AppError::Unauthorized("No refresh token available".into()))?;

    let _client_id = env_var("STEAM_CLIENT_ID")?;
    let _client_secret = env_var("STEAM_CLIENT_SECRET")?;

    let token_resp: SteamTokenResponse = Client::new()
        .post(format!("{}/oauth2/token", STEAM_API_BASE))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("client_id", &env_var("STEAM_CLIENT_ID")?),
            ("client_secret", &env_var("STEAM_CLIENT_SECRET")?),
        ])
        .send()
        .await?
        .json()
        .await?;

    // Met à jour les tokens
    let access_token_enc = crypto.encrypt(&token_resp.access_token)?;
    let refresh_token_enc = crypto.encrypt(&token_resp.refresh_token)?;

    let now = Utc::now().timestamp_millis();

    db.update_oauth_tokens(
        &db.get_current_user_id().await?,
        "steam",
        Some(access_token_enc),
        Some(refresh_token_enc),
        None,
        Some(now + token_resp.expires_in * 1000),
        None,
        Some(token_resp.scope),
    ).await?;

    Ok(())
}

/// Déconnecte (révoque) le compte Steam
#[tauri::command]
#[specta::specta]
pub async fn steam_revoke(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<()> {
    let user_id = db.get_current_user_id().await?;
    let account = db.get_oauth_account(&user_id, "steam").await?
        .ok_or_else(|| AppError::NotFound("Steam account not linked".into()))?;

    // Révoque le token côté Steam
    if let Some(access_token_enc) = &account.access_token_enc {
        if let Ok(access_token) = crypto.decrypt(access_token_enc) {
            let _ = Client::new()
                .post(format!("{}/oauth2/revoke", STEAM_API_BASE))
                .form(&[("token", &access_token)])
                .send()
                .await;
        }
    }

    // Supprime le compte local
    db.unlink_oauth_account(&user_id, "steam").await?;

    Ok(())
}

// ─── Helpers ───

async fn get_or_create_user(
    db: &Database,
    username: &str,
    steam_id: Option<&str>,
) -> AppResult<String> {
    // Essaie de trouver un user existant avec ce steam_id
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

    // Réutilise le profil local orphelin s'il existe
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

    // Crée un nouvel utilisateur
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