use thiserror::Error;
use tauri::Runtime;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Crypto error: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error("Steam API error: {0}")]
    SteamApi(String),

    #[error("PSN API error: {0}")]
    PsnApi(String),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

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

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Anyhow error: {0}")]
    Anyhow(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

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

impl From<CryptoError> for AppError {
    fn from(err: CryptoError) -> Self {
        AppError::Crypto(err)
    }
}

// Tauri command error conversion
impl<R: Runtime> From<AppError> for tauri::Error<R> {
    fn from(err: AppError) -> Self {
        tauri::Error::from(err.to_string())
    }
}

// Helper to convert anyhow::Error to AppError
pub fn anyhow_to_app_error(err: anyhow::Error) -> AppError {
    AppError::Anyhow(err)
}