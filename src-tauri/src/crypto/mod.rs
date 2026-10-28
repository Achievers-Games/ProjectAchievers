use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use getrandom::getrandom;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use crate::error::{CryptoError, AppResult};
use tracing::info;
use chrono::{DateTime, Utc};

#[derive(Clone)]
pub struct Crypto {
    master_key: [u8; 32],
    app_handle: tauri::AppHandle,
}

impl Crypto {
    pub fn new(app_handle: &tauri::AppHandle) -> AppResult<Self> {
        let master_key = Self::derive_or_create_master_key(app_handle)?;
        Ok(Self {
            master_key,
            app_handle: app_handle.clone(),
        })
    }

    /// Preference file path inside the app data directory (`<name>.pref.enc`).
    fn preference_path(&self, name: &str) -> AppResult<PathBuf> {
        let dir = self
            .app_handle
            .path()
            .app_data_dir()
            .map_err(|e| CryptoError::KeyDerivation(format!("Failed to get app data dir: {}", e)))?;
        std::fs::create_dir_all(&dir)?;
        Ok(dir.join(format!("{}.pref.enc", name)))
    }

    /// Saves a secret preference (e.g. the Steam API key) encrypted with the master key.
    pub fn save_preference(&self, name: &str, value: &str) -> AppResult<()> {
        let encrypted = self.encrypt(value)?;
        std::fs::write(self.preference_path(name)?, encrypted)?;
        info!("Saved encrypted preference '{}'", name);
        Ok(())
    }

    /// Loads and decrypts a secret preference. Returns `None` when not set.
    pub fn load_preference(&self, name: &str) -> AppResult<Option<String>> {
        let path = self.preference_path(name)?;
        if !path.exists() {
            return Ok(None);
        }
        let encrypted = std::fs::read_to_string(path)?;
        Ok(Some(self.decrypt(encrypted.trim())?))
    }

    /// Deletes a secret preference from disk.
    pub fn clear_preference(&self, name: &str) -> AppResult<()> {
        let path = self.preference_path(name)?;
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    fn derive_or_create_master_key(app_handle: &tauri::AppHandle) -> AppResult<[u8; 32]> {
        let key_path = Self::get_key_path(app_handle)?;

        if key_path.exists() {
            // Load existing key
            let encrypted_key = std::fs::read(&key_path)?;
            let key = Self::decrypt_master_key(&encrypted_key)?;
            Ok(key)
        } else {
            // Generate new master key
            let mut key = [0u8; 32];
            getrandom(&mut key).map_err(|e| CryptoError::KeyDerivation(format!("Failed to generate random key: {}", e)))?;

            // Encrypt and store
            let encrypted = Self::encrypt_master_key(&key)?;
            std::fs::write(&key_path, encrypted)?;

            info!("Generated new master encryption key");
            Ok(key)
        }
    }

    fn get_key_path(app_handle: &tauri::AppHandle) -> AppResult<PathBuf> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| CryptoError::KeyDerivation(format!("Failed to get app data dir: {}", e)))?;

        std::fs::create_dir_all(&app_data_dir)?;
        Ok(app_data_dir.join("master.key"))
    }

    fn encrypt_master_key(key: &[u8; 32]) -> AppResult<Vec<u8>> {
        // Use a fixed salt for the master key encryption (derived from device)
        // In production, this should use platform-specific secure storage
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();

        // For now, use a simple approach - in production use DPAPI/Keychain
        let password = Self::get_device_password()?;
        let hash = argon2.hash_password(password.as_bytes(), &salt)
            .map_err(|e| CryptoError::PasswordHashing(e.to_string()))?;

        let cipher = Aes256Gcm::new_from_slice(hash.hash.unwrap().as_bytes())
            .map_err(|e| CryptoError::Encryption(e.to_string()))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, key.as_ref())
            .map_err(|e| CryptoError::Encryption(e.to_string()))?;

        let mut result = Vec::new();
        result.extend_from_slice(salt.as_str().as_bytes());
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    fn decrypt_master_key(encrypted: &[u8]) -> AppResult<[u8; 32]> {
        let salt_str = std::str::from_utf8(&encrypted[..22])
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;
        let salt = SaltString::from_b64(salt_str)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;
        let nonce = Nonce::from_slice(&encrypted[22..34]);
        let ciphertext = &encrypted[34..];

        let password = Self::get_device_password()?;
        let argon2 = Argon2::default();
        let hash = argon2.hash_password(password.as_bytes(), &salt)
            .map_err(|e| CryptoError::PasswordHashing(e.to_string()))?;

        let cipher = Aes256Gcm::new_from_slice(hash.hash.unwrap().as_bytes())
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;
        let plaintext = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;

        let mut key = [0u8; 32];
        key.copy_from_slice(&plaintext);
        Ok(key)
    }

    fn get_device_password() -> AppResult<String> {
        // In production, use platform-specific secure storage:
        // Windows: DPAPI (CryptProtectData)
        // macOS: Keychain
        // Linux: Secret Service (libsecret)
        // For now, use a machine-specific identifier
        use std::process::Command;

        #[cfg(target_os = "windows")]
        {
            // `wmic` was removed on modern Windows; read MachineGuid from the registry instead.
            let output = Command::new("reg")
                .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
                .output()?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let guid = stdout
                .lines()
                .find_map(|line| {
                    let tokens: Vec<&str> = line.split_whitespace().collect();
                    if tokens.len() >= 3 && tokens[0].eq_ignore_ascii_case("MachineGuid") {
                        Some(tokens[2].to_string())
                    } else {
                        None
                    }
                })
                .unwrap_or_default();
            Ok(format!("project-achievers-{}", guid))
        }

        #[cfg(target_os = "macos")]
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()?;

        #[cfg(target_os = "linux")]
        let output = Command::new("cat")
            .args(["/etc/machine-id"])
            .output()?;

        #[cfg(not(target_os = "windows"))]
        {
            let machine_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(format!("project-achievers-{}", machine_id))
        }
    }

    pub fn encrypt(&self, plaintext: &str) -> AppResult<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|e| CryptoError::Encryption(e.to_string()))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes())
            .map_err(|e| CryptoError::Encryption(e.to_string()))?;

        let mut result = Vec::new();
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);

        Ok(BASE64.encode(result))
    }

    pub fn decrypt(&self, encrypted: &str) -> AppResult<String> {
        let data = BASE64.decode(encrypted)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;
        let nonce = Nonce::from_slice(&data[..12]);
        let ciphertext = &data[12..];

        let cipher = Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;
        let plaintext = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;

        Ok(String::from_utf8(plaintext)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?)
    }

    pub fn hash_password(&self, password: &str) -> AppResult<String> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2.hash_password(password.as_bytes(), &salt)
            .map_err(|e| CryptoError::PasswordHashing(e.to_string()))?;
        Ok(hash.to_string())
    }

    pub fn verify_password(&self, password: &str, hash: &str) -> AppResult<bool> {
        let parsed_hash = PasswordHash::new(hash)
            .map_err(|e| CryptoError::PasswordHashing(e.to_string()))?;
        let argon2 = Argon2::default();
        Ok(argon2.verify_password(password.as_bytes(), &parsed_hash).is_ok())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JwtClaims {
    pub sub: String,        // user_id
    pub sid: String,        // session_id
    pub iat: i64,           // issued at
    pub exp: i64,           // expires at
    pub token_type: String, // "access" | "refresh"
}

impl Crypto {
    /// Creates a JWT access token (short-lived, ~15 min)
    pub fn create_access_token(&self, user_id: &str, session_id: &str) -> AppResult<String> {
        let now = Utc::now().timestamp();
        let claims = JwtClaims {
            sub: user_id.to_string(),
            sid: session_id.to_string(),
            iat: now,
            exp: now + 15 * 60, // 15 minutes
            token_type: "access".to_string(),
        };
        let encoding_key = EncodingKey::from_secret(&self.master_key);
        let token = encode(&Header::new(Algorithm::HS256), &claims, &encoding_key)
            .map_err(|e| CryptoError::Encryption(e.to_string()))?;
        Ok(token)
    }

    /// Creates a JWT refresh token (long-lived, ~30 days)
    pub fn create_refresh_token(&self, user_id: &str, session_id: &str) -> AppResult<String> {
        let now = Utc::now().timestamp();
        let claims = JwtClaims {
            sub: user_id.to_string(),
            sid: session_id.to_string(),
            iat: now,
            exp: now + 30 * 24 * 60 * 60, // 30 days
            token_type: "refresh".to_string(),
        };
        let encoding_key = EncodingKey::from_secret(&self.master_key);
        let token = encode(&Header::new(Algorithm::HS256), &claims, &encoding_key)
            .map_err(|e| CryptoError::Encryption(e.to_string()))?;
        Ok(token)
    }

    /// Validates a JWT token and returns the claims if valid
    pub fn validate_token(&self, token: &str) -> AppResult<JwtClaims> {
        let decoding_key = DecodingKey::from_secret(&self.master_key);
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = true;
        let token_data: TokenData<JwtClaims> = decode(token, &decoding_key, &validation)
            .map_err(|e| CryptoError::Decryption(e.to_string()))?;
        Ok(token_data.claims)
    }

    /// Validates an access token specifically
    pub fn validate_access_token(&self, token: &str) -> AppResult<JwtClaims> {
        let claims = self.validate_token(token)?;
        if claims.token_type != "access" {
            return Err(CryptoError::Decryption("Invalid token type: expected access".into()).into());
        }
        Ok(claims)
    }

    /// Validates a refresh token specifically
    pub fn validate_refresh_token(&self, token: &str) -> AppResult<JwtClaims> {
        let claims = self.validate_token(token)?;
        if claims.token_type != "refresh" {
            return Err(CryptoError::Decryption("Invalid token type: expected refresh".into()).into());
        }
        Ok(claims)
    }

    /// Extracts token expiry as DateTime<Utc>
    pub fn token_expiry(&self, token: &str) -> AppResult<DateTime<Utc>> {
        let claims = self.validate_token(token)?;
        DateTime::from_timestamp(claims.exp, 0)
            .ok_or_else(|| CryptoError::Decryption("Invalid expiry timestamp".into()).into())
    }
}