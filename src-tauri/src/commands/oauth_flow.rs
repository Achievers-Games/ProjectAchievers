use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use urlencoding::encode;

const DISCORD_AUTHORIZE: &str = "https://discord.com/oauth2/authorize";

/// Pending OAuth authorization, kept in memory until the loopback callback
/// arrives. The state value is the CSRF token and the map key.
#[derive(Debug, Clone)]
pub struct PendingOAuth {
    pub provider: String,
    pub redirect_uri: String,
    pub code_verifier: Option<String>,
    pub created_at: i64,
}

/// In-memory store for in-flight OAuth authorizations.
#[derive(Default)]
pub struct OAuthManager {
    pending: Mutex<HashMap<String, PendingOAuth>>,
}

impl OAuthManager {
    fn insert(&self, state: String, pending: PendingOAuth) {
        let mut map = match self.pending.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = chrono::Utc::now().timestamp_millis();
        // Drop stale authorizations (10 minutes) to avoid unbounded growth.
        map.retain(|_, p| now - p.created_at < 10 * 60 * 1000);
        map.insert(state, pending);
    }

    /// Validate and consume the pending authorization for this state.
    pub fn take(&self, state: &str, expected_provider: &str) -> AppResult<PendingOAuth> {
        let mut map = match self.pending.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let pending = map
            .remove(state)
            .ok_or_else(|| AppError::Unauthorized("Unknown or expired OAuth state".into()))?;
        if pending.provider != expected_provider {
            return Err(AppError::Unauthorized("OAuth provider mismatch".into()));
        }
        if chrono::Utc::now().timestamp_millis() - pending.created_at > 10 * 60 * 1000 {
            return Err(AppError::Unauthorized("OAuth authorization expired".into()));
        }
        Ok(pending)
    }
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct OAuthBeginResponse {
    pub provider: String,
    pub url: String,
    pub state: String,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct OAuthCallbackEvent {
    pub provider: String,
    pub code: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub error_description: Option<String>,
    // For Steam OpenID - contains all openid.* parameters
    #[serde(rename = "openidParams")]
    pub openid_params: Option<std::collections::HashMap<String, String>>,
}

/// Start an OAuth 2.0 / OpenID authorization using a local loopback redirect URI.
///
/// Binds an ephemeral port on 127.0.0.1, returns the provider authorize URL,
/// then waits (up to 5 minutes) for the browser redirect. The result is sent
/// to the frontend through the `oauth-callback` event.
#[tauri::command]
#[specta::specta]
pub async fn oauth_begin(
    app: AppHandle,
    manager: State<'_, OAuthManager>,
    provider: String,
) -> AppResult<OAuthBeginResponse> {
    let provider = provider.to_lowercase();

    // Validate provider
    match provider.as_str() {
        "steam" | "discord" => {}
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported provider: {other}"
            )))
        }
    };

    let preferred_port: u16 = std::env::var("OAUTH_REDIRECT_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(42813);
    // Prefer a stable port so providers with strict redirect-URI allowlists can
    // register it once; fall back to an ephemeral port if it is already in use.
    let listener = match TcpListener::bind(("127.0.0.1", preferred_port)).await {
        Ok(listener) => listener,
        Err(_) => TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AppError::Internal(format!("Failed to bind OAuth callback listener: {e}")))?,
    };
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("Failed to read listener address: {e}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let state = generate_state();
    let code_verifier = if provider == "discord" {
        Some(generate_pkce_verifier())
    } else {
        None
    };

    // Build provider-specific authorization URL
    let url = match provider.as_str() {
        "steam" => {
            // Steam uses OpenID 2.0, not OAuth2
            let realm = std::env::var("STEAM_OPENID_REALM")
                .map_err(|_| AppError::Internal("STEAM_OPENID_REALM not configured".into()))?;
            let return_to = std::env::var("STEAM_OPENID_RETURN_TO")
                .map_err(|_| AppError::Internal("STEAM_OPENID_RETURN_TO not configured".into()))?;

            format!(
                "https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.mode=checkid_setup&openid.return_to={}&openid.realm={}&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.state={}",
                encode(&return_to),
                encode(&realm),
                encode(&state)
            )
        }
        "discord" => {
            let client_id = std::env::var("DISCORD_CLIENT_ID")
                .map_err(|_| AppError::Internal("DISCORD_CLIENT_ID not configured".into()))?;
            let scopes = std::env::var("DISCORD_SCOPES").unwrap_or_else(|_| "identify email".into());

            let challenge = generate_pkce_challenge(
                code_verifier
                    .as_deref()
                    .ok_or_else(|| AppError::Internal("Missing PKCE verifier".into()))?,
            );
            format!(
                "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
                DISCORD_AUTHORIZE,
                encode(&client_id),
                encode(&redirect_uri),
                encode(&scopes),
                encode(&state),
                encode(&challenge),
            )
        }
        _ => unreachable!("provider validated above"),
    };

    manager.insert(
        state.clone(),
        PendingOAuth {
            provider: provider.clone(),
            redirect_uri,
            code_verifier,
            created_at: chrono::Utc::now().timestamp_millis(),
        },
    );

    let app_handle = app.clone();
    let provider_for_task = provider.clone();
    let state_for_task = state.clone();
    tauri::async_runtime::spawn(async move {
        let accepted = tokio::time::timeout(Duration::from_secs(300), listener.accept()).await;
        let mut event = OAuthCallbackEvent {
            provider: provider_for_task,
            code: None,
            state: state_for_task,
            error: None,
            error_description: None,
            openid_params: None,
        };

        match accepted {
            Ok(Ok((mut stream, _addr))) => {
                let mut buf = vec![0u8; 8192];
                let read = stream.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]).to_string();
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");

                if let Ok(parsed) = url::Url::parse(&format!("http://127.0.0.1{path}")) {
                    let mut openid_params: Option<std::collections::HashMap<String, String>> = None;

                    for (key, value) in parsed.query_pairs() {
                        match key.as_ref() {
                            "code" => event.code = Some(value.into_owned()),
                            "state" => event.state = value.into_owned(),
                            "error" => event.error = Some(value.into_owned()),
                            "error_description" => {
                                event.error_description = Some(value.into_owned())
                            }
                            _ => {
                                // Capture all openid.* parameters for Steam OpenID
                                if key.starts_with("openid.") {
                                    if openid_params.is_none() {
                                        openid_params = Some(std::collections::HashMap::new());
                                    }
                                    if let Some(ref mut map) = openid_params {
                                        map.insert(key.into_owned(), value.into_owned());
                                    }
                                }
                            }
                        }
                    }

                    // Store OpenID parameters if present (for Steam)
                    if let Some(map) = openid_params {
                        if !map.is_empty() {
                            event.openid_params = Some(map);
                        }
                    }
                }

                let (title, message) = if event.error.is_some() {
                    (
                        "Autorisation refusée",
                        "La connexion a été annulée. Vous pouvez fermer cette fenêtre.",
                    )
                } else {
                    (
                        "Connexion réussie",
                        "Retournez à Project Achievers. Vous pouvez fermer cette fenêtre.",
                    )
                };
                let body = format!(
                    "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>{title}</title></head>\
                     <body style=\"font-family:system-ui,sans-serif;background:#0f1117;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0;text-align:center\">\
                     <main><h1 style=\"font-size:1.4rem\">{title}</h1><p style=\"color:#9aa0a6\">{message}</p></main></body></html>"
                );
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.flush().await;
            }
            Ok(Err(e)) => {
                event.error = Some("server_error".into());
                event.error_description = Some(e.to_string());
            }
            Err(_) => {
                event.error = Some("timeout".into());
                event.error_description = Some(
                    "Aucune réponse du fournisseur OAuth dans le délai imparti.".into(),
                );
            }
        }

        let _ = app_handle.emit("oauth-callback", event);
    });

    Ok(OAuthBeginResponse {
        provider,
        url,
        state,
    })
}

fn generate_state() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

fn generate_pkce_verifier() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..64)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

fn generate_pkce_challenge(verifier: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}
