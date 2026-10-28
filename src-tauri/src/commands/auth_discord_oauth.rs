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

const DISCORD_API_BASE: &str = "https://discord.com/api";

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct DiscordTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
    pub scope: String,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    pub discriminator: String,
    pub avatar: Option<String>,
    pub email: Option<String>,
    pub verified: bool,
    pub locale: Option<String>,
    pub mfa_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct DiscordAuthUrlResponse {
    pub url: String,
    pub state: String,
    pub code_verifier: String, // Pour PKCE
}

/// Génère l'URL d'autorisation Discord OAuth 2.0 avec PKCE
#[tauri::command]
#[specta::specta]
pub async fn discord_oauth_url() -> AppResult<DiscordAuthUrlResponse> {
    let client_id = std::env::var("DISCORD_CLIENT_ID")
        .map_err(|_| AppError::Internal("DISCORD_CLIENT_ID not configured".into()))?;
    let redirect_uri = std::env::var("DISCORD_REDIRECT_URI")
        .map_err(|_| AppError::Internal("DISCORD_REDIRECT_URI not configured".into()))?;

    // Génère PKCE code_verifier et code_challenge (S256)
    let code_verifier = generate_pkce_verifier();
    let code_challenge = generate_pkce_challenge(&code_verifier);

    // State CSRF aléatoire
    let state = generate_state();

    let scopes = "identify email";
    let url = format!(
        "https://discord.com/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        encode(&client_id),
        encode(&redirect_uri),
        encode(scopes),
        encode(&state),
        encode(&code_challenge)
    );

    Ok(DiscordAuthUrlResponse {
        url,
        state,
        code_verifier, // Le frontend doit le stocker pour le callback
    })
}

/// Callback Discord OAuth 2.0 avec PKCE
#[tauri::command]
#[specta::specta]
pub async fn discord_oauth_callback(
    code: String,
    state: String,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
    manager: State<'_, OAuthManager>,
) -> AppResult<AuthResult> {
    // Validate the CSRF state and retrieve the PKCE verifier + loopback redirect
    // URI captured when the flow started.
    let pending = manager.take(&state, "discord")?;
    let code_verifier = pending
        .code_verifier
        .ok_or_else(|| AppError::Internal("Missing PKCE verifier for Discord".into()))?;

    let client_id = std::env::var("DISCORD_CLIENT_ID")
        .map_err(|_| AppError::Internal("DISCORD_CLIENT_ID not configured".into()))?;
    let client_secret = std::env::var("DISCORD_CLIENT_SECRET")
        .map_err(|_| AppError::Internal("DISCORD_CLIENT_SECRET not configured".into()))?;
    let redirect_uri = pending.redirect_uri;

    let client = Client::new();

    // 1. Échange le code contre les tokens (avec PKCE)
    let token_resp: DiscordTokenResponse = client
        .post(format!("{}/oauth2/token", DISCORD_API_BASE))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", &code_verifier),
        ])
        .send()
        .await?
        .json()
        .await?;

    // 2. Récupère le profil utilisateur
    let user: DiscordUser = client
        .get(format!("{}/users/@me", DISCORD_API_BASE))
        .bearer_auth(&token_resp.access_token)
        .send()
        .await?
        .json()
        .await?;

    // 3. Vérifie si le compte Discord est déjà lié
    let existing = sqlx::query(
        "SELECT user_id FROM oauth_accounts WHERE provider = 'discord' AND provider_user_id = ?"
    )
    .bind(&user.id)
    .fetch_optional(&db.pool)
    .await?;

    let (user_id, is_new_user) = if let Some(row) = existing {
        let uid: String = row.get("user_id");
        (uid, false)
    } else {
        let display_name = format!("{}#{}", user.username, user.discriminator);
        let uid = get_or_create_user(&db, &display_name, Some(&user.id)).await?;
        (uid, true)
    };

    // 4. Chiffre les tokens
    let access_token_enc = crypto.encrypt(&token_resp.access_token)?;
    let refresh_token_enc = crypto.encrypt(&token_resp.refresh_token)?;

    let now = Utc::now().timestamp_millis();
    let token_expires_at = now + (token_resp.expires_in * 1000);
    let refresh_expires_at = now + (30 * 24 * 60 * 60 * 1000); // 30 jours

    let discord_handle = format!("{}#{}", user.username, user.discriminator);
    let discord_avatar = user
        .avatar
        .clone()
        .map(|a| format!("https://cdn.discordapp.com/avatars/{}/{}", user.id, a));

    // 5. Crée/met à jour le compte OAuth
    let oauth_account = OAuthAccount {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.clone(),
        provider: "discord".to_string(),
        provider_user_id: user.id.clone(),
        access_token_enc: Some(access_token_enc),
        refresh_token_enc: Some(refresh_token_enc),
        id_token_enc: None,
        token_expires_at: Some(token_expires_at),
        refresh_expires_at: Some(refresh_expires_at),
        scope: Some(token_resp.scope),
        token_type: Some(token_resp.token_type),
        email: user.email.clone(),
        username: Some(discord_handle.clone()),
        display_name: Some(user.username.clone()),
        avatar_url: discord_avatar.clone(),
        profile_url: Some(format!("https://discord.com/users/{}", user.id)),
        country_code: user.locale.clone(),
        is_primary: true,
        linked_at: now,
        last_synced_at: Some(now),
        sync_status: "completed".to_string(),
        sync_error: None,
    };

    db.link_oauth_account(&user_id, &oauth_account).await?;

    // Surface the Discord account in platform_accounts so the settings page and
    // the generic linked-accounts list can display it.
    sqlx::query(
        r#"
        INSERT INTO platform_accounts (
            id, user_id, platform, platform_user_id, platform_username, avatar_url,
            last_synced_at, sync_status, sync_error, created_at, updated_at
        ) VALUES (?, ?, 'discord', ?, ?, ?, ?, 'completed', NULL, ?, ?)
        ON CONFLICT(user_id, platform) DO UPDATE SET
            platform_user_id = excluded.platform_user_id,
            platform_username = excluded.platform_username,
            avatar_url = excluded.avatar_url,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&user_id)
    .bind(&user.id)
    .bind(&discord_handle)
    .bind(&discord_avatar)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&db.pool)
    .await?;

    Ok(AuthResult {
        success: true,
        user_id,
        is_new_user,
        linked_account: Some(oauth_account),
    })
}

/// Rafraîchit le token d'accès Discord
#[tauri::command]
#[specta::specta]
pub async fn discord_refresh_token(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<()> {
    let user_id = db.get_current_user_id().await?;

    let account = db.get_oauth_account(&user_id, "discord").await?
        .ok_or_else(|| AppError::NotFound("Discord account not linked".into()))?;

    let refresh_token = account.refresh_token_enc
        .and_then(|enc| crypto.decrypt(&enc).ok())
        .ok_or_else(|| AppError::Unauthorized("No refresh token available".into()))?;

    let client = Client::new();
    let token_resp: DiscordTokenResponse = client
        .post(format!("{}/oauth2/token", DISCORD_API_BASE))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("client_id", &std::env::var("DISCORD_CLIENT_ID")?),
            ("client_secret", &std::env::var("DISCORD_CLIENT_SECRET")?),
        ])
        .send()
        .await?
        .json()
        .await?;

    let access_token_enc = crypto.encrypt(&token_resp.access_token)?;
    let refresh_token_enc = crypto.encrypt(&token_resp.refresh_token)?;

    let now = Utc::now().timestamp_millis();

    db.update_oauth_tokens(
        &db.get_current_user_id().await?,
        "discord",
        Some(access_token_enc),
        Some(refresh_token_enc),
        None,
        Some(now + token_resp.expires_in * 1000),
        None,
        Some(token_resp.scope),
    ).await?;

    Ok(())
}

/// Déconnecte (révoque) le compte Discord
#[tauri::command]
#[specta::specta]
pub async fn discord_revoke(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<()> {
    let user_id = db.get_current_user_id().await?;
    let account = db.get_oauth_account(&user_id, "discord").await?
        .ok_or_else(|| AppError::NotFound("Discord account not linked".into()))?;

    // Révoque le token côté Discord
    if let Some(access_token_enc) = &account.access_token_enc {
        if let Ok(access_token) = crypto.decrypt(access_token_enc) {
            let _ = Client::new()
                .post(format!("{}/oauth2/token/revoke", DISCORD_API_BASE))
                .form(&[
                    ("client_id", &std::env::var("DISCORD_CLIENT_ID")?),
                    ("client_secret", &std::env::var("DISCORD_CLIENT_SECRET")?),
                    ("token", &access_token),
                ])
                .send()
                .await;
        }
    }

    db.unlink_oauth_account(&user_id, "discord").await?;
    Ok(())
}

// ─── Helpers ───

fn generate_pkce_verifier() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..64).map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char).collect()
}

fn generate_pkce_challenge(verifier: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

fn generate_state() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..32).map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char).collect()
}

async fn get_or_create_user(
    db: &Database,
    username: &str,
    discord_id: Option<&str>,
) -> AppResult<String> {
    // Essaie de trouver un user existant avec ce discord_id
    if let Some(did) = discord_id {
        let existing = sqlx::query(
            "SELECT u.id FROM users u
             JOIN oauth_accounts oa ON oa.user_id = u.id
             WHERE oa.provider = 'discord' AND oa.provider_user_id = ?"
        )
        .bind(did)
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

