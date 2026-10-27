use crate::{
    database::Database,
    error::{AppError, AppResult, TauriResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SyncStatus {
    pub platform: String,
    pub last_synced_at: Option<i64>,
    pub sync_status: String,
    pub sync_error: Option<String>,
    pub games_synced: i32,
    pub achievements_synced: i32,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SyncAllResult {
    pub steam: SyncResult,
    pub psn: SyncResult,
    pub total_games: i32,
    pub total_achievements: i32,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SyncResult {
    pub synced_games: u32,
    pub synced_achievements: u32,
    pub errors: Vec<String>,
}

/// Sync all platforms for the current user
#[tauri::command]
#[specta::specta]
pub async fn sync_all_platforms(
    db: State<'_, Database>,
    crypto: State<'_, crate::crypto::Crypto>,
) -> AppResult<SyncAllResult> {
    let start = std::time::Instant::now();
    let user_id = get_current_user_id(&db).await?;

    // Check which platforms are linked
    let platforms = sqlx::query(
        "SELECT platform FROM platform_accounts WHERE user_id = ?"
    )
    .bind(&user_id)
    .fetch_all(&db.pool)
    .await?;

    let mut steam_result = SyncResult {
        synced_games: 0,
        synced_achievements: 0,
        errors: vec![],
    };

    let mut psn_result = SyncResult {
        synced_games: 0,
        synced_achievements: 0,
        errors: vec![],
    };

    // Sync Steam if linked
    if platforms.iter().any(|r| r.get::<String, _>("platform") == "steam") {
        let steam_res = crate::commands::steam::steam_sync_user_data(db.clone(), crypto.clone()).await?;
        steam_result = SyncResult {
            synced_games: steam_res.synced_games,
            synced_achievements: steam_res.synced_achievements,
            errors: steam_res.errors,
        };
    }

    // Sync PSN if linked
    if platforms.iter().any(|r| r.get::<String, _>("platform") == "psn") {
        let psn_res = crate::commands::psn::psn_sync_user_data(db.clone(), crypto.clone()).await?;
        psn_result = SyncResult {
            synced_games: psn_res.synced_games,
            synced_achievements: psn_res.synced_achievements,
            errors: psn_res.errors,
        };
    }

    let total_games = steam_result.synced_games + psn_result.synced_games;
    let total_achievements = steam_result.synced_achievements + psn_result.synced_achievements;
    let duration = start.elapsed().as_millis() as i64;

    Ok(SyncAllResult {
        steam: steam_result,
        psn: psn_result,
        total_games: total_games as i32,
        total_achievements: total_achievements as i32,
        duration_ms: duration,
    })
}

/// Get sync status for all linked platforms
#[tauri::command]
#[specta::specta]
pub async fn get_sync_status(
    db: State<'_, Database>,
) -> AppResult<Vec<SyncStatus>> {
    let user_id = get_current_user_id(&db).await?;

    let rows = sqlx::query(
        r#"
        SELECT pa.platform, pa.last_synced_at, pa.sync_status, pa.sync_error,
               COUNT(DISTINCT g.id) as games_synced,
               COUNT(DISTINCT a.id) as achievements_synced
        FROM platform_accounts pa
        LEFT JOIN games g ON (pa.platform = 'steam' AND g.steam_app_id IS NOT NULL) OR (pa.platform = 'psn' AND g.psn_title_id IS NOT NULL)
        LEFT JOIN achievements a ON a.game_id = g.id
        WHERE pa.user_id = ?
        GROUP BY pa.platform
        "#
    )
    .bind(&user_id)
    .fetch_all(&db.pool)
    .await?;

    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(SyncStatus {
            platform: row.get("platform"),
            last_synced_at: row.get("last_synced_at"),
            sync_status: row.get("sync_status"),
            sync_error: row.get("sync_error"),
            games_synced: row.get("games_synced"),
            achievements_synced: row.get("achievements_synced"),
        });
    }

    Ok(statuses)
}

/// Trigger background sync (non-blocking)
#[tauri::command]
#[specta::specta]
pub async fn trigger_background_sync(
    db: State<'_, Database>,
    crypto: State<'_, crate::crypto::Crypto>,
) -> AppResult<()> {
    // This would spawn a background task in a real implementation
    // For now, just return success
    Ok(())
}

/// Get sync history
#[tauri::command]
#[specta::specta]
pub async fn get_sync_history(
    limit: Option<i32>,
    db: State<'_, Database>,
) -> AppResult<Vec<SyncHistoryEntry>> {
    let user_id = get_current_user_id(&db).await?;
    let lim = limit.unwrap_or(20);

    // In a real implementation, you'd have a sync_history table
    // For now, return from platform_accounts
    let rows = sqlx::query(
        r#"
        SELECT platform, last_synced_at, sync_status, sync_error
        FROM platform_accounts
        WHERE user_id = ? AND last_synced_at IS NOT NULL
        ORDER BY last_synced_at DESC
        LIMIT ?
        "#
    )
    .bind(&user_id)
    .bind(lim)
    .fetch_all(&db.pool)
    .await?;

    let history = rows
        .into_iter()
        .map(|row| SyncHistoryEntry {
            platform: row.get("platform"),
            synced_at: row.get("last_synced_at"),
            status: row.get("sync_status"),
            error: row.get("sync_error"),
            games_synced: 0, // Would come from history table
            achievements_synced: 0,
        })
        .collect();

    Ok(history)
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SyncHistoryEntry {
    pub platform: String,
    pub synced_at: i64,
    pub status: String,
    pub error: Option<String>,
    pub games_synced: i32,
    pub achievements_synced: i32,
}

/// Force re-sync for a specific game
#[tauri::command]
#[specta::specta]
pub async fn force_sync_game(
    game_id: String,
    db: State<'_, Database>,
    crypto: State<'_, crate::crypto::Crypto>,
) -> AppResult<SyncResult> {
    let user_id = get_current_user_id(&db).await?;

    // Get game platform
    let game = sqlx::query("SELECT platform, steam_app_id, psn_title_id FROM games WHERE id = ?")
        .bind(&game_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Internal("Game not found".to_string()))?;

    let platform: String = game.get("platform");

    match platform.as_str() {
        "steam" => {
            let app_id: i64 = game.get("steam_app_id");
            crate::commands::steam::steam_get_game_schema(app_id as u32, db.clone(), crypto.clone()).await?;
            crate::commands::steam::steam_get_player_achievements(app_id as u32, db.clone(), crypto.clone()).await?;
            crate::commands::steam::steam_get_global_achievement_percentages(app_id as u32, db.clone(), crypto.clone()).await?;
            Ok(SyncResult {
                synced_games: 1,
                synced_achievements: 0, // Would count actual
                errors: vec![],
            })
        }
        "psn" => {
            // PSN sync would go here
            Err(AppError::Internal("PSN sync not available".to_string()))
        }
        _ => Err(AppError::Internal("Unknown platform".to_string())),
    }
}

async fn get_current_user_id(db: &Database) -> AppResult<String> {
    let row = sqlx::query("SELECT id FROM users LIMIT 1")
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Internal("No user found".to_string()))?;

    Ok(row.get("id"))
}