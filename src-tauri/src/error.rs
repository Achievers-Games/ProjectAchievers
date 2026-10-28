use thiserror::Error;
use serde::{Serialize, Deserialize};
use specta::Type;

/// Application-wide error type.
///
/// All variants carry serializable payloads (strings / plain numbers) so the
/// enum can derive both `Serialize` (for the Tauri IPC boundary) and
/// `specta::Type` (for the generated TypeScript bindings). Foreign error types
/// (sqlx, reqwest, std::io, ...) are converted at construction time via the
/// `From` impls below.
#[derive(Error, Debug, Serialize, PartialEq, Type)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Steam API error: {0}")]
    SteamApi(String),

    #[error("PSN API error: {0}")]
    PsnApi(String),

    #[error("HTTP error: {0}")]
    Http(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Rate limited: retry after {retry_after} seconds")]
    RateLimited { retry_after: u64 },

    #[error("Platform not supported: {0}")]
    PlatformNotSupported(String),

    #[error("Sync error: {0}")]
    Sync(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// Type alias for internal use
pub type AppResult<T> = Result<T, AppError>;

/// Result of an OAuth authentication flow
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AuthResult {
    pub success: bool,
    pub user_id: String,
    pub is_new_user: bool,
    pub linked_account: Option<crate::database::OAuthAccount>,
}

// Type alias for Tauri commands - uses tauri::Error which implements IpcResponse
pub type TauriResult<T> = Result<T, tauri::Error>;

// Manual From impls (converting foreign errors into string-carrying variants)
impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database(err.to_string())
    }
}

impl From<CryptoError> for AppError {
    fn from(err: CryptoError) -> Self {
        Self::Crypto(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        Self::Http(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

impl From<std::env::VarError> for AppError {
    fn from(err: std::env::VarError) -> Self {
        Self::Internal(format!("Environment variable error: {}", err))
    }
}

// Custom error for crypto
#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    Encryption(String),

    #[error("Decryption failed: {0}")]
    Decryption(String),

    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),

    #[error("Invalid key format")]
    InvalidKeyFormat,

    #[error("Password hashing failed: {0}")]
    PasswordHashing(String),
}

// Helper to convert anyhow::Error to AppError
pub fn anyhow_to_app_error(err: anyhow::Error) -> AppError {
    AppError::Internal(err.to_string())
}

// Implement From<AppError> for tauri::Error to support Tauri v2 command return types
impl From<AppError> for tauri::Error {
    fn from(err: AppError) -> Self {
        tauri::Error::Anyhow(anyhow::anyhow!(err))
    }
}

// Helper function to convert any error to tauri::Error for command return types
pub fn into_tauri_error<E: std::error::Error + Send + Sync + 'static>(err: E) -> tauri::Error {
    tauri::Error::Anyhow(anyhow::anyhow!(err.to_string()))
}

impl From<tauri_plugin_opener::Error> for AppError {
    fn from(err: tauri_plugin_opener::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

impl From<tauri_plugin_global_shortcut::Error> for AppError {
    fn from(err: tauri_plugin_global_shortcut::Error) -> Self {
        Self::Internal(err.to_string())
    }
}