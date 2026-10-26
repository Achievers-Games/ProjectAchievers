use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use directories::ProjectDirs;
use std::path::PathBuf;
use tauri::Manager;
use zeroize::Zeroize;
use anyhow::Result;
use tracing::{info, error};

#[derive(Clone)]
pub struct Crypto {
    master_key: [u8; 32],
    app_handle: tauri::AppHandle,
}

impl Crypto {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let master_key = Self::derive_or_create_master_key(app_handle)?;
        Ok(Self {
            master_key,
            app_handle: app_handle.clone(),
        })
    }

    fn derive_or_create_master_key(app_handle: &tauri::AppHandle) -> Result<[u8; 32]> {
        let key_path = Self::get_key_path(app_handle)?;

        if key_path.exists() {
            // Load existing key
            let encrypted_key = std::fs::read(&key_path)?;
            let key = Self::decrypt_master_key(&encrypted_key)?;
            Ok(key)
        } else {
            // Generate new master key
            let mut key = [0u8; 32];
            getrandom::fill(&mut key)?;

            // Encrypt and store
            let encrypted = Self::encrypt_master_key(&key)?;
            std::fs::write(&key_path, encrypted)?;

            info!("Generated new master encryption key");
            Ok(key)
        }
    }

    fn get_key_path(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

        std::fs::create_dir_all(&app_data_dir)?;
        Ok(app_data_dir.join("master.key"))
    }

    fn encrypt_master_key(key: &[u8; 32]) -> Result<Vec<u8>> {
        // Use a fixed salt for the master key encryption (derived from device)
        // In production, this should use platform-specific secure storage
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();

        // For now, use a simple approach - in production use DPAPI/Keychain
        let password = Self::get_device_password()?;
        let hash = argon2.hash_password(password.as_bytes(), &salt)?;

        let cipher = Aes256Gcm::new_from_slice(hash.hash.unwrap().as_bytes())?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, key.as_ref())?;

        let mut result = Vec::new();
        result.extend_from_slice(salt.as_str().as_bytes());
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    fn decrypt_master_key(encrypted: &[u8]) -> Result<[u8; 32]> {
        let salt_str = std::str::from_utf8(&encrypted[..22])?;
        let salt = SaltString::from_b64(salt_str)?;
        let nonce = Nonce::from_slice(&encrypted[22..34]);
        let ciphertext = &encrypted[34..];

        let password = Self::get_device_password()?;
        let argon2 = Argon2::default();
        let hash = argon2.hash_password(password.as_bytes(), &salt)?;

        let cipher = Aes256Gcm::new_from_slice(hash.hash.unwrap().as_bytes())?;
        let plaintext = cipher.decrypt(nonce, ciphertext)?;

        let mut key = [0u8; 32];
        key.copy_from_slice(&plaintext);
        Ok(key)
    }

    fn get_device_password() -> Result<String> {
        // In production, use platform-specific secure storage:
        // Windows: DPAPI (CryptProtectData)
        // macOS: Keychain
        // Linux: Secret Service (libsecret)
        // For now, use a machine-specific identifier
        use std::process::Command;

        #[cfg(target_os = "windows")]
        let output = Command::new("wmic")
            .args(["csproduct", "get", "UUID"])
            .output()?;

        #[cfg(target_os = "macos")]
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()?;

        #[cfg(target_os = "linux")]
        let output = Command::new("cat")
            .args(["/etc/machine-id"])
            .output()?;

        let machine_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(format!("project-achievers-{}", machine_id))
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key)?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes())?;

        let mut result = Vec::new();
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);

        Ok(base64::encode(result))
    }

    pub fn decrypt(&self, encrypted: &str) -> Result<String> {
        let data = base64::decode(encrypted)?;
        let nonce = Nonce::from_slice(&data[..12]);
        let ciphertext = &data[12..];

        let cipher = Aes256Gcm::new_from_slice(&self.master_key)?;
        let plaintext = cipher.decrypt(nonce, ciphertext)?;

        Ok(String::from_utf8(plaintext)?)
    }

    pub fn hash_password(&self, password: &str) -> Result<String> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2.hash_password(password.as_bytes(), &salt)?;
        Ok(hash.to_string())
    }

    pub fn verify_password(&self, password: &str, hash: &str) -> Result<bool> {
        let parsed_hash = PasswordHash::new(hash)?;
        let argon2 = Argon2::default();
        Ok(argon2.verify_password(password.as_bytes(), &parsed_hash).is_ok())
    }
}

impl Drop for Crypto {
    fn drop(&mut self) {
        self.master_key.zeroize();
    }
}