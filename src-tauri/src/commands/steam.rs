use crate::{
    crypto::Crypto,
    database::Database,
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use reqwest::Client;

const STEAM_API_BASE: &str = "https://api.steampowered.com";

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamOwnedGame {
    pub appid: u32,
    pub name: String,
    pub playtime_forever: Option<u32>,
    pub playtime_windows_forever: Option<u32>,
    pub playtime_mac_forever: Option<u32>,
    pub playtime_linux_forever: Option<u32>,
    pub img_icon_url: String,
    pub img_logo_url: String,
    pub has_community_visible_stats: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamPlayerAchievement {
    pub apiname: String,
    pub achieved: i32,
    pub unlocktime: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamGameSchema {
    pub game_name: String,
    pub game_version: String,
    pub available_game_stats: SteamAvailableGameStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamAvailableGameStats {
    pub achievements: Vec<SteamAchievementDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamAchievementDefinition {
    pub name: String,
    pub defaultvalue: i32,
    pub displayname: String,
    pub hidden: i32,
    pub description: String,
    pub icon: String,
    pub icongray: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamGlobalAchievementPercentages {
    pub achievementpercentages: SteamAchievementPercentages,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamAchievementPercentages {
    pub achievements: Vec<SteamGlobalAchievement>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamGlobalAchievement {
    pub name: String,
    pub percent: f64,
}

async fn get_steam_api_key(db: &Database, user_id: &str) -> AppResult<Option<String>> {
    let row = sqlx::query(
        "SELECT encrypted_access_token FROM platform_accounts WHERE user_id = ? AND platform = 'steam'"
    )
    .bind(user_id)
    .fetch_optional(&db.pool)
    .await?;

    if let Some(row) = row {
        let encrypted: Option<String> = row.get("encrypted_access_token");
        if let Some(enc) = encrypted {
            // In a real implementation, we'd decrypt using the crypto module
            // For now, return None to indicate we need a configured API key
            return Ok(None);
        }
    }
    Ok(None)
}

/// Get owned games for the current user
#[tauri::command]
pub async fn steam_get_owned_games(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<Vec<SteamOwnedGame>> {
    let user_id = get_current_user_id(&db).await?;
    let api_key = get_steam_api_key(&db, &user_id).await?;

    // Get Steam ID from platform_accounts
    let row = sqlx::query(
        "SELECT platform_user_id FROM platform_accounts WHERE user_id = ? AND platform = 'steam'"
    )
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    let steam_id = row
        .and_then(|r| r.get::<Option<String>, _>("platform_user_id"))
        .ok_or_else(|| AppError::NotFound("Steam account not linked".to_string()))?;

    let client = Client::new();
    let api_key = api_key.unwrap_or_else(|| std::env::var("STEAM_API_KEY").unwrap_or_default());

    let url = format!(
        "{}/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&format=json&include_appinfo=1&include_played_free_games=1",
        STEAM_API_BASE, api_key, steam_id
    );

    let response = client.get(&url).send().await?;
    let data: serde_json::Value = response.json().await?;

    let games = data["response"]["games"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|g| serde_json::from_value(g.clone()).ok())
        .collect();

    Ok(games)
}

/// Get player achievements for a specific game
#[tauri::command]
pub async fn steam_get_player_achievements(
    app_id: u32,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<Vec<SteamPlayerAchievement>> {
    let user_id = get_current_user_id(&db).await?;
    let api_key = get_steam_api_key(&db, &user_id).await?;

    let row = sqlx::query(
        "SELECT platform_user_id FROM platform_accounts WHERE user_id = ? AND platform = 'steam'"
    )
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    let steam_id = row
        .and_then(|r| r.get::<Option<String>, _>("platform_user_id"))
        .ok_or_else(|| AppError::NotFound("Steam account not linked".to_string()))?;

    let client = Client::new();
    let api_key = api_key.unwrap_or_else(|| std::env::var("STEAM_API_KEY").unwrap_or_default());

    let url = format!(
        "{}/ISteamUserStats/GetPlayerAchievements/v1/?key={}&steamid={}&appid={}&format=json",
        STEAM_API_BASE, api_key, steam_id, app_id
    );

    let response = client.get(&url).send().await?;
    let data: serde_json::Value = response.json().await?;

    let achievements = data["playerstats"]["achievements"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|a| serde_json::from_value(a.clone()).ok())
        .collect();

    Ok(achievements)
}

/// Get game schema (achievement definitions)
#[tauri::command]
pub async fn steam_get_game_schema(
    app_id: u32,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<SteamGameSchema> {
    let user_id = get_current_user_id(&db).await?;
    let api_key = get_steam_api_key(&db, &user_id).await?;

    let client = Client::new();
    let api_key = api_key.unwrap_or_else(|| std::env::var("STEAM_API_KEY").unwrap_or_default());

    let url = format!(
        "{}/ISteamUserStats/GetSchemaForGame/v2/?key={}&appid={}&format=json",
        STEAM_API_BASE, api_key, app_id
    );

    let response = client.get(&url).send().await?;
    let data: serde_json::Value = response.json().await?;

    let schema: SteamGameSchema = serde_json::from_value(data["game"].clone())
        .map_err(|e| AppError::SteamApi(format!("Failed to parse schema: {}", e)))?;

    Ok(schema)
}

/// Get global achievement percentages for a game
#[tauri::command]
pub async fn steam_get_global_achievement_percentages(
    app_id: u32,
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<Vec<SteamGlobalAchievement>> {
    let client = Client::new();

    let url = format!(
        "{}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={}&format=json",
        STEAM_API_BASE, app_id
    );

    let response = client.get(&url).send().await?;
    let data: serde_json::Value = response.json().await?;

    let percentages = data["achievementpercentages"]["achievements"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|a| serde_json::from_value(a.clone()).ok())
        .collect();

    Ok(percentages)
}

/// Sync all Steam data for the current user
#[tauri::command]
pub async fn steam_sync_user_data(
    db: State<'_, Database>,
    crypto: State<'_, Crypto>,
) -> AppResult<SyncResult> {
    let user_id = get_current_user_id(&db).await?;
    let api_key = get_steam_api_key(&db, &user_id).await?;

    let row = sqlx::query(
        "SELECT platform_user_id FROM platform_accounts WHERE user_id = ? AND platform = 'steam'"
    )
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    let steam_id = row
        .and_then(|r| r.get::<Option<String>, _>("platform_user_id"))
        .ok_or_else(|| AppError::NotFound("Steam account not linked".to_string()))?;

    let api_key = api_key.unwrap_or_else(|| std::env::var("STEAM_API_KEY").unwrap_or_default());
    let client = Client::new();

    // Update sync status
    sqlx::query(
        "UPDATE platform_accounts SET sync_status = 'syncing', updated_at = strftime('%s', 'now') * 1000 WHERE user_id = ? AND platform = 'steam'"
    )
    .bind(&user_id)
    .execute(&db.pool)
    .await?;

    let mut synced_games = 0;
    let mut synced_achievements = 0;
    let mut errors = Vec::new();

    // Get owned games
    let owned_games = steam_get_owned_games(db.clone(), crypto.clone()).await?;

    for game in owned_games {
        if !game.has_community_visible_stats {
            continue;
        }

        // Get or create game in database
        let game_id = upsert_game(&db, &game).await?;

        // Get achievement schema
        match steam_get_game_schema(game.appid, db.clone(), crypto.clone()).await {
            Ok(schema) => {
                for ach_def in schema.available_game_stats.achievements {
                    let _ = upsert_achievement(&db, &game_id, &ach_def).await;
                    synced_achievements += 1;
                }
            }
            Err(e) => {
                errors.push(format!("Game {}: {}", game.name, e));
            }
        }

        // Get player achievements
        match steam_get_player_achievements(game.appid, db.clone(), crypto.clone()).await {
            Ok(player_achievements) => {
                for player_ach in player_achievements {
                    if player_ach.achieved == 1 {
                        if let Some(unlock_time) = player_ach.unlocktime {
                            let _ = upsert_user_achievement(&db, &user_id, &game_id, &player_ach, unlock_time).await;
                        }
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Game {} achievements: {}", game.name, e));
            }
        }

        // Get global percentages
        if let Ok(percentages) = steam_get_global_achievement_percentages(game.appid, db.clone(), crypto.clone()).await {
            for pct in percentages {
                let _ = update_achievement_rarity(&db, &game_id, &pct.name, pct.percent).await;
            }
        }

        synced_games += 1;
    }

    // Update last synced timestamp
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "UPDATE platform_accounts SET last_synced_at = ?, sync_status = 'completed', sync_error = ?, updated_at = strftime('%s', 'now') * 1000 WHERE user_id = ? AND platform = 'steam'"
    )
    .bind(&now)
    .bind(if errors.is_empty() { None } else { Some(errors.join("; ")) })
    .bind(&user_id)
    .execute(&db.pool)
    .await?;

    Ok(SyncResult {
        synced_games,
        synced_achievements,
        errors,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub synced_games: u32,
    pub synced_achievements: u32,
    pub errors: Vec<String>,
}

async fn upsert_game(db: &Database, game: &SteamOwnedGame) -> AppResult<String> {
    let existing = sqlx::query("SELECT id FROM games WHERE steam_app_id = ?")
        .bind(game.appid as i64)
        .fetch_optional(&db.pool)
        .await?;

    if let Some(row) = existing {
        let id: String = row.get("id");
        // Update game info
        sqlx::query(
            r#"
            UPDATE games SET
                name = ?, cover_url = ?, header_url = ?, updated_at = strftime('%s', 'now') * 1000
            WHERE id = ?
            "#,
        )
        .bind(&game.name)
        .bind(format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg", game.appid))
        .bind(format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/library_600x900.jpg", game.appid))
        .bind(&id)
        .execute(&db.pool)
        .await?;
        return Ok(id);
    }

    let game_id = Uuid::new_v4().to_string();
    let slug = slugify(&game.name);
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO games (id, steam_app_id, name, slug, cover_url, header_url, platform, total_achievements, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'steam', 0, ?, ?)
        "#,
    )
    .bind(&game_id)
    .bind(game.appid as i64)
    .bind(&game.name)
    .bind(&slug)
    .bind(format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg", game.appid))
    .bind(format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/library_600x900.jpg", game.appid))
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    Ok(game_id)
}

async fn upsert_achievement(db: &Database, game_id: &str, def: &SteamAchievementDefinition) -> AppResult<String> {
    let existing = sqlx::query("SELECT id FROM achievements WHERE game_id = ? AND platform_achievement_id = ?")
        .bind(game_id)
        .bind(&def.name)
        .fetch_optional(&db.pool)
        .await?;

    if let Some(row) = existing {
        return Ok(row.get("id"));
    }

    let ach_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO achievements (id, game_id, platform_achievement_id, name, description, icon_url, icon_gray_url, hidden, trophy_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'achievement', ?, ?)
        "#,
    )
    .bind(&ach_id)
    .bind(game_id)
    .bind(&def.name)
    .bind(&def.displayname)
    .bind(&def.description)
    .bind(format!("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{}/{}", "", def.icon))
    .bind(format!("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{}/{}", "", def.icongray))
    .bind(def.hidden == 1)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    Ok(ach_id)
}

async fn upsert_user_achievement(
    db: &Database,
    user_id: &str,
    game_id: &str,
    player_ach: &SteamPlayerAchievement,
    unlock_time: i64,
) -> AppResult<()> {
    let ach_row = sqlx::query("SELECT id FROM achievements WHERE game_id = ? AND platform_achievement_id = ?")
        .bind(game_id)
        .bind(&player_ach.apiname)
        .fetch_optional(&db.pool)
        .await?;

    let achievement_id = if let Some(row) = ach_row {
        row.get("id")
    } else {
        return Ok(()); // Achievement not in our DB yet
    };

    sqlx::query(
        r#"
        INSERT INTO user_achievements (id, user_id, achievement_id, unlocked_at, rarity_at_unlock, platform, created_at)
        VALUES (?, ?, ?, ?, 0.0, 'steam', strftime('%s', 'now') * 1000)
        ON CONFLICT(user_id, achievement_id) DO UPDATE SET
            unlocked_at = excluded.unlocked_at,
            rarity_at_unlock = excluded.rarity_at_unlock
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(&achievement_id)
    .bind(unlock_time * 1000) // Convert to milliseconds
    .execute(&db.pool)
    .await?;

    Ok(())
}

async fn update_achievement_rarity(db: &Database, game_id: &str, api_name: &str, percent: f64) -> AppResult<()> {
    sqlx::query(
        "UPDATE achievements SET global_rarity = ?, updated_at = strftime('%s', 'now') * 1000 WHERE game_id = ? AND platform_achievement_id = ?"
    )
    .bind(percent)
    .bind(game_id)
    .bind(api_name)
    .execute(&db.pool)
    .await?;

    Ok(())
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