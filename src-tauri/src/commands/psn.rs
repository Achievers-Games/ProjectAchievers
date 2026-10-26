use crate::{
    crypto::Crypto,
    database::Database,
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;
use reqwest::Client;

/// PSN trophy title (game)
#[derive(Debug, Serialize, Deserialize)]
pub struct PsnTrophyTitle {
    pub np_communication_id: String,
    pub trophy_title_name: String,
    pub trophy_title_detail: String,
    pub trophy_title_icon_url: String,
    pub trophy_title_platform: String,
    pub has_trophy_groups: bool,
    pub defined_trophies: PsnDefinedTrophies,
    pub progress: Option<u32>,
    pub hidden_flag: bool,
}

/// PSN trophy group
#[derive(Debug, Serialize, Deserialize)]
pub struct PsnTrophyGroup {
    pub trophy_group_id: String,
    pub trophy_group_name: String,
    pub trophy_group_detail: String,
    pub trophy_group_icon_url: String,
    pub trophy_group_sort_order: i32,
    pub trophies: Vec<PsnTrophy>,
}

/// PSN trophy
#[derive(Debug, Serialize, Deserialize)]
pub struct PsnTrophy {
    pub trophy_id: String,
    pub trophy_hidden: bool,
    pub trophy_type: String,
    pub trophy_rare: i32,
    pub trophy_name: String,
    pub trophy_detail: String,
    pub trophy_icon_url: String,
    pub trophy_small_icon_url: String,
    pub earned: bool,
    pub earned_date_time: Option<String>,
}

/// PSN defined trophies summary
#[derive(Debug, Serialize, Deserialize)]
pub struct PsnDefinedTrophies {
    pub platinum: i32,
    pub gold: i32,
    pub silver: i32,
    pub bronze: i32,
}

/// Get trophy titles (games) for the current user
#[tauri::command]
pub async fn psn_get_trophy_titles(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<Vec<PsnTrophyTitle>> {
    let user_id = get_current_user_id(&db).await?;

    // Get NPSSO token
    let row = sqlx::query(
        "SELECT platform_user_id, encrypted_access_token FROM platform_accounts WHERE user_id = ? AND platform = 'psn'"
    )
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    let (psn_id, encrypted_npsso) = row
        .and_then(|r| {
            let id: Option<String> = r.get("platform_user_id");
            let token: Option<String> = r.get("encrypted_access_token");
            id.zip(token)
        })
        .ok_or_else(|| AppError::NotFound("PSN account not linked".to_string()))?;

    let npsso = crypto.decrypt(&encrypted_npsso)?;
    let client = Client::new();

    // Use PSN API (limited access)
    // Note: This requires proper PSN API access which is not publicly available
    // For MVP, we'll return an informative error
    Err(AppError::PlatformNotSupported(
        "PSN trophy API requires official Sony partnership. For now, use PSNProfiles.com import or manual entry. See: https://github.com/ProjectAchievers/docs#psn-integration".to_string()
    ))
}

/// Get trophy groups for a specific title
#[tauri::command]
pub async fn psn_get_trophy_groups(
    np_communication_id: String,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<Vec<PsnTrophyGroup>> {
    let user_id = get_current_user_id(&db).await?;

    let row = sqlx::query(
        "SELECT encrypted_access_token FROM platform_accounts WHERE user_id = ? AND platform = 'psn'"
    )
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    let encrypted_npsso = row
        .and_then(|r| r.get::<Option<String>, _>("encrypted_access_token"))
        .ok_or_else(|| AppError::NotFound("PSN account not linked".to_string()))?;

    let npsso = crypto.decrypt(&encrypted_npsso)?;

    // This would call the PSN API
    Err(AppError::PlatformNotSupported(
        "PSN trophy groups API not publicly available".to_string()
    ))
}

/// Get trophies for a specific group
#[tauri::command]
pub async fn psn_get_trophies(
    np_communication_id: String,
    trophy_group_id: String,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<Vec<PsnTrophy>> {
    let user_id = get_current_user_id(&db).await?;

    let row = sqlx::query(
        "SELECT encrypted_access_token FROM platform_accounts WHERE user_id = ? AND platform = 'psn'"
    )
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    let encrypted_npsso = row
        .and_then(|r| r.get::<Option<String>, _>("encrypted_access_token"))
        .ok_or_else(|| AppError::NotFound("PSN account not linked".to_string()))?;

    let npsso = crypto.decrypt(&encrypted_npsso)?;

    // This would call the PSN API
    Err(AppError::PlatformNotSupported(
        "PSN trophies API not publicly available".to_string()
    ))
}

/// Sync PSN data (placeholder - shows the structure)
#[tauri::command]
pub async fn psn_sync_user_data(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<PsnSyncResult> {
    let user_id = get_current_user_id(&db).await?;

    // Update sync status
    sqlx::query(
        "UPDATE platform_accounts SET sync_status = 'syncing', updated_at = strftime('%s', 'now') * 1000 WHERE user_id = ? AND platform = 'psn'"
    )
    .bind(&user_id)
    .execute(&db.pool)
    .await?;

    // In a real implementation, this would:
    // 1. Call PSN API to get trophy titles
    // 2. For each title, get trophy groups and trophies
    // 3. Upsert games, achievements, user_achievements

    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "UPDATE platform_accounts SET last_synced_at = ?, sync_status = 'completed', sync_error = ?, updated_at = strftime('%s', 'now') * 1000 WHERE user_id = ? AND platform = 'psn'"
    )
    .bind(&now)
    .bind(Some("PSN API not publicly available. Use PSNProfiles import.".to_string()))
    .bind(&user_id)
    .execute(&db.pool)
    .await?;

    Ok(PsnSyncResult {
        synced_games: 0,
        synced_trophies: 0,
        message: "PSN sync requires official API access. Use PSNProfiles import feature instead.".to_string(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PsnSyncResult {
    pub synced_games: u32,
    pub synced_trophies: u32,
    pub message: String,
}

/// Import PSN data from PSNProfiles.com (community API)
#[tauri::command]
pub async fn psn_import_from_psnprofiles(
    psnprofiles_username: String,
    db: State<'_, Database>,
) -> AppResult<PsnImportResult> {
    let client = Client::new();
    let url = format!("https://psnprofiles.com/api/profile/{}", psnprofiles_username);

    let response = client.get(&url).send().await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await?;
            // Parse PSNProfiles data and import
            // This is a simplified version
            Ok(PsnImportResult {
                success: true,
                games_imported: 0,
                trophies_imported: 0,
                message: "PSNProfiles import not fully implemented yet".to_string(),
            })
        }
        Ok(resp) => {
            Ok(PsnImportResult {
                success: false,
                games_imported: 0,
                trophies_imported: 0,
                message: format!("PSNProfiles API error: {}", resp.status()),
            })
        }
        Err(e) => {
            Ok(PsnImportResult {
                success: false,
                games_imported: 0,
                trophies_imported: 0,
                message: format!("Network error: {}", e),
            })
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PsnImportResult {
    pub success: bool,
    pub games_imported: u32,
    pub trophies_imported: u32,
    pub message: String,
}

/// Manual trophy entry for PSN
#[tauri::command]
pub async fn psn_add_manual_trophy(
    game_name: String,
    trophy_name: String,
    trophy_type: String, // platinum, gold, silver, bronze
    description: String,
    earned: bool,
    earned_date: Option<String>,
    db: State<'_, Database>,
) -> AppResult<String> {
    let user_id = get_current_user_id(&db).await?;

    // Find or create game
    let game_id = find_or_create_psn_game(&db, &game_name).await?;

    // Create achievement
    let ach_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO achievements (id, game_id, platform_achievement_id, name, description, trophy_type, hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, FALSE, ?, ?)
        "#,
    )
    .bind(&ach_id)
    .bind(&game_id)
    .bind(Uuid::new_v4().to_string())
    .bind(&trophy_name)
    .bind(&description)
    .bind(&trophy_type)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    if earned {
        let earned_ts = earned_date
            .and_then(|d| chrono::DateTime::parse_from_rfc3339(&d).ok())
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(now);

        sqlx::query(
            r#"
            INSERT INTO user_achievements (id, user_id, achievement_id, unlocked_at, rarity_at_unlock, platform, created_at)
            VALUES (?, ?, ?, ?, 0.0, 'psn', strftime('%s', 'now') * 1000)
            ON CONFLICT(user_id, achievement_id) DO UPDATE SET
                unlocked_at = excluded.unlocked_at
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&user_id)
        .bind(&ach_id)
        .bind(earned_ts)
        .execute(&db.pool)
        .await?;
    }

    Ok(ach_id)
}

async fn find_or_create_psn_game(db: &Database, name: &str) -> AppResult<String> {
    let slug = slugify(name);

    let existing = sqlx::query("SELECT id FROM games WHERE slug = ? AND platform = 'psn'")
        .bind(&slug)
        .fetch_optional(&db.pool)
        .await?;

    if let Some(row) = existing {
        return Ok(row.get("id"));
    }

    let game_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO games (id, name, slug, platform, total_achievements, created_at, updated_at)
        VALUES (?, ?, ?, 'psn', 0, ?, ?)
        "#,
    )
    .bind(&game_id)
    .bind(name)
    .bind(&slug)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    Ok(game_id)
}

fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

async fn get_current_user_id(db: &Database) -> AppResult<String> {
    let row = sqlx::query("SELECT id FROM users LIMIT 1")
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("No user found".to_string()))?;

    Ok(row.get("id"))
}