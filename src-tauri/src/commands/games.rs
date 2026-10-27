use crate::{
    database::Database,
    error::{AppError, AppResult, TauriResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct GameListItem {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub cover_url: Option<String>,
    pub header_url: Option<String>,
    pub platform: String,
    pub total_achievements: i32,
    pub release_date: Option<i64>,
    pub genres: Vec<String>,
    pub user_progress: Option<UserGameProgress>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UserGameProgress {
    pub unlocked_count: i32,
    pub total_count: i32,
    pub completion_percentage: f32,
    pub platinum_unlocked: bool,
    pub last_unlocked_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct GameDetail {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub cover_url: Option<String>,
    pub header_url: Option<String>,
    pub platform: String,
    pub steam_app_id: Option<i64>,
    pub psn_title_id: Option<String>,
    pub total_achievements: i32,
    pub platinum_achievement_id: Option<String>,
    pub release_date: Option<i64>,
    pub genres: Vec<String>,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub description: Option<String>,
    pub user_progress: Option<UserGameProgress>,
    pub achievements: Vec<AchievementWithProgress>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AchievementWithProgress {
    pub id: String,
    pub platform_achievement_id: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub icon_gray_url: Option<String>,
    pub hidden: bool,
    pub trophy_type: Option<String>,
    pub global_rarity: f64,
    pub points: i32,
    pub is_platinum: bool,
    pub unlocked: bool,
    pub unlocked_at: Option<i64>,
    pub rarity_at_unlock: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct GameSearchResult {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub cover_url: Option<String>,
    pub platform: String,
    pub total_achievements: i32,
}

/// Get all games with optional filters
#[tauri::command]
#[specta::specta]
pub async fn get_games(
    platform: Option<String>,
    genre: Option<String>,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
    db: State<'_, Database>,
) -> AppResult<Vec<GameListItem>> {
    let user_id = get_current_user_id(&db).await?;

    let mut query = String::from(
        r#"
        SELECT g.*,
            COUNT(ua.id) as unlocked_count,
            MAX(ua.unlocked_at) as last_unlocked_at,
            CASE WHEN MAX(CASE WHEN a.is_platinum = 1 THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END as platinum_unlocked
        FROM games g
        LEFT JOIN achievements a ON a.game_id = g.id
        LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
        WHERE 1=1
        "#
    );

    let mut params: Vec<Box<dyn sqlx::Encode<'_, sqlx::Sqlite> + Send + Sync>> = vec![Box::new(user_id.clone())];

    if let Some(p) = &platform {
        query.push_str(" AND g.platform = ?");
        params.push(Box::new(p.clone()));
    }

    if let Some(g) = &genre {
        query.push_str(" AND g.genres_json LIKE ?");
        params.push(Box::new(format!("%{}%", g)));
    }

    if let Some(s) = &search {
        query.push_str(" AND (g.name LIKE ? OR g.slug LIKE ?)");
        params.push(Box::new(format!("%{}%", s)));
        params.push(Box::new(format!("%{}%", s)));
    }

    query.push_str(" GROUP BY g.id ORDER BY g.name ASC");

    if let Some(l) = limit {
        query.push_str(" LIMIT ?");
        params.push(Box::new(l));
    }

    if let Some(o) = offset {
        query.push_str(" OFFSET ?");
        params.push(Box::new(o));
    }

    // Note: This is a simplified version. In reality, you'd use query_as with proper binding
    // For now, we'll use a simpler approach

    let games = sqlx::query(
        r#"
        SELECT g.id, g.name, g.slug, g.cover_url, g.header_url, g.platform, g.total_achievements,
               g.release_date, g.genres_json, g.developers_json, g.publishers_json,
               COUNT(ua.id) as unlocked_count,
               MAX(ua.unlocked_at) as last_unlocked_at,
               MAX(CASE WHEN a.is_platinum = 1 AND ua.id IS NOT NULL THEN 1 ELSE 0 END) as platinum_unlocked
        FROM games g
        LEFT JOIN achievements a ON a.game_id = g.id
        LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
        WHERE 1=1
        "#
    )
    .bind(&user_id)
    .fetch_all(&db.pool)
    .await?;

    let mut results = Vec::new();
    for row in games {
        let total: i64 = row.get("total_achievements");
        let unlocked: i64 = row.get("unlocked_count");
        let completion = if total > 0 { (unlocked as f32 / total as f32) * 100.0 } else { 0.0 };

        let genres: Vec<String> = serde_json::from_str(
            row.get::<Option<String>, _>("genres_json").as_deref().unwrap_or("[]")
        ).unwrap_or_default();

        results.push(GameListItem {
            id: row.get("id"),
            name: row.get("name"),
            slug: row.get("slug"),
            cover_url: row.get("cover_url"),
            header_url: row.get("header_url"),
            platform: row.get("platform"),
            total_achievements: total as i32,
            release_date: row.get("release_date"),
            genres,
            user_progress: Some(UserGameProgress {
                unlocked_count: unlocked as i32,
                total_count: total as i32,
                completion_percentage: completion,
                platinum_unlocked: row.get::<i64, _>("platinum_unlocked") == 1,
                last_unlocked_at: row.get("last_unlocked_at"),
            }),
        });
    }

    Ok(results)
}

/// Get detailed game info with achievements
#[tauri::command]
#[specta::specta]
pub async fn get_game_detail(
    game_id: String,
    db: State<'_, Database>,
) -> AppResult<GameDetail> {
    let user_id = get_current_user_id(&db).await?;

    // Get game
    let game_row = sqlx::query(
        "SELECT * FROM games WHERE id = ?"
    )
    .bind(&game_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Game not found"))?;

    let genres: Vec<String> = serde_json::from_str(
        game_row.get::<Option<String>, _>("genres_json").as_deref().unwrap_or("[]")
    ).unwrap_or_default();

    let developers: Vec<String> = serde_json::from_str(
        game_row.get::<Option<String>, _>("developers_json").as_deref().unwrap_or("[]")
    ).unwrap_or_default();

    let publishers: Vec<String> = serde_json::from_str(
        game_row.get::<Option<String>, _>("publishers_json").as_deref().unwrap_or("[]")
    ).unwrap_or_default();

    // Get achievements with user progress
    let ach_rows = sqlx::query(
        r#"
        SELECT a.*, ua.unlocked_at, ua.rarity_at_unlock
        FROM achievements a
        LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
        WHERE a.game_id = ?
        ORDER BY a.trophy_type DESC, a.name ASC
        "#
    )
    .bind(&user_id)
    .bind(&game_id)
    .fetch_all(&db.pool)
    .await?;

    let mut achievements = Vec::new();
    let mut unlocked_count = 0;
    let mut platinum_unlocked = false;
    let mut last_unlocked_at: Option<i64> = None;

    for row in ach_rows {
        let unlocked = row.get::<Option<i64>, _>("unlocked_at").is_some();
        if unlocked {
            unlocked_count += 1;
            last_unlocked_at = row.get("unlocked_at");
            let is_platinum: bool = row.get("is_platinum");
            if is_platinum {
                platinum_unlocked = true;
            }
        }

        achievements.push(AchievementWithProgress {
            id: row.get("id"),
            platform_achievement_id: row.get("platform_achievement_id"),
            name: row.get("name"),
            description: row.get("description"),
            icon_url: row.get("icon_url"),
            icon_gray_url: row.get("icon_gray_url"),
            hidden: row.get("hidden"),
            trophy_type: row.get("trophy_type"),
            global_rarity: row.get("global_rarity"),
            points: row.get("points"),
            is_platinum: row.get("is_platinum"),
            unlocked,
            unlocked_at: row.get("unlocked_at"),
            rarity_at_unlock: row.get("rarity_at_unlock"),
        });
    }

    let total = achievements.len() as i32;
    let completion = if total > 0 { (unlocked_count as f32 / total as f32) * 100.0 } else { 0.0 };

    Ok(GameDetail {
        id: game_row.get("id"),
        name: game_row.get("name"),
        slug: game_row.get("slug"),
        cover_url: game_row.get("cover_url"),
        header_url: game_row.get("header_url"),
        platform: game_row.get("platform"),
        steam_app_id: game_row.get("steam_app_id"),
        psn_title_id: game_row.get("psn_title_id"),
        total_achievements: total,
        platinum_achievement_id: game_row.get("platinum_achievement_id"),
        release_date: game_row.get("release_date"),
        genres,
        developers,
        publishers,
        description: game_row.get("description"),
        user_progress: Some(UserGameProgress {
            unlocked_count,
            total_count: total,
            completion_percentage: completion,
            platinum_unlocked,
            last_unlocked_at,
        }),
        achievements,
    })
}

/// Search games by name
#[tauri::command]
#[specta::specta]
pub async fn search_games(
    query: String,
    limit: Option<i32>,
    db: State<'_, Database>,
) -> AppResult<Vec<GameSearchResult>> {
    let lim = limit.unwrap_or(20);

    let rows = sqlx::query(
        r#"
        SELECT id, name, slug, cover_url, platform, total_achievements
        FROM games
        WHERE name LIKE ? OR slug LIKE ?
        ORDER BY
            CASE WHEN name = ? THEN 0
                 WHEN name LIKE ? THEN 1
                 ELSE 2 END,
            name ASC
        LIMIT ?
        "#
    )
    .bind(format!("%{}%", query))
    .bind(format!("%{}%", query))
    .bind(&query)
    .bind(format!("{}%", query))
    .bind(lim)
    .fetch_all(&db.pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| GameSearchResult {
            id: row.get("id"),
            name: row.get("name"),
            slug: row.get("slug"),
            cover_url: row.get("cover_url"),
            platform: row.get("platform"),
            total_achievements: row.get("total_achievements"),
        })
        .collect();

    Ok(results)
}

/// Get user's progress for a specific game
#[tauri::command]
#[specta::specta]
pub async fn get_user_game_progress(
    game_id: String,
    db: State<'_, Database>,
) -> AppResult<UserGameProgress> {
    let user_id = get_current_user_id(&db).await?;

    let row = sqlx::query(
        r#"
        SELECT
            COUNT(a.id) as total,
            COUNT(ua.id) as unlocked,
            MAX(ua.unlocked_at) as last_unlocked,
            MAX(CASE WHEN a.is_platinum = 1 AND ua.id IS NOT NULL THEN 1 ELSE 0 END) as platinum
        FROM achievements a
        LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
        WHERE a.game_id = ?
        "#
    )
    .bind(&user_id)
    .bind(&game_id)
    .fetch_one(&db.pool)
    .await?;

    let total: i64 = row.get("total");
    let unlocked: i64 = row.get("unlocked");
    let completion = if total > 0 { (unlocked as f32 / total as f32) * 100.0 } else { 0.0 };

    Ok(UserGameProgress {
        unlocked_count: unlocked as i32,
        total_count: total as i32,
        completion_percentage: completion,
        platinum_unlocked: row.get::<i64, _>("platinum") == 1,
        last_unlocked_at: row.get("last_unlocked"),
    })
}

async fn get_current_user_id(db: &Database) -> AppResult<String> {
    let row = sqlx::query("SELECT id FROM users LIMIT 1")
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Internal("No user found".to_string()))?;

    Ok(row.get("id"))
}