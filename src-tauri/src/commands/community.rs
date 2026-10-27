use crate::{database::Database, error::AppResult};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

/// Une entrée du flux d'activité communautaire : un succès débloqué récemment.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct FeedItem {
    pub id: String,
    pub achievement_id: String,
    pub username: String,
    pub avatar_url: Option<String>,
    pub game_name: String,
    pub game_slug: String,
    pub game_cover_url: Option<String>,
    pub achievement_name: String,
    pub achievement_icon_url: Option<String>,
    pub trophy_type: Option<String>,
    pub unlocked_at: i64,
    pub rarity: Option<f64>,
}

/// Entrée du classement des chasseurs de succès.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct LeaderboardEntry {
    pub username: String,
    pub avatar_url: Option<String>,
    pub unlocked: i64,
    pub platinums: i64,
    pub points: i64,
}

/// Flux d'activité : derniers succès débloqués par la communauté.
#[tauri::command]
#[specta::specta]
pub async fn get_community_feed(
    db: State<'_, Database>,
    limit: Option<i32>,
) -> AppResult<Vec<FeedItem>> {
    let limit = limit.unwrap_or(20).clamp(1, 100);

    let rows = sqlx::query(
        r#"
        SELECT
            ua.id AS id,
            ua.achievement_id AS achievement_id,
            ua.unlocked_at AS unlocked_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS username,
            pa.avatar_url AS avatar_url,
            g.name AS game_name,
            g.slug AS game_slug,
            g.cover_url AS game_cover_url,
            a.name AS achievement_name,
            a.icon_url AS achievement_icon_url,
            a.trophy_type AS trophy_type,
            a.global_rarity AS rarity
        FROM user_achievements ua
        JOIN users u ON u.id = ua.user_id
        JOIN achievements a ON a.id = ua.achievement_id
        JOIN games g ON g.id = a.game_id
        LEFT JOIN platform_accounts pa
            ON pa.user_id = ua.user_id AND pa.platform = ua.platform
        ORDER BY ua.unlocked_at DESC
        LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(&db.pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| FeedItem {
            id: row.get("id"),
            achievement_id: row.get("achievement_id"),
            username: row.get("username"),
            avatar_url: row.get("avatar_url"),
            game_name: row.get("game_name"),
            game_slug: row.get("game_slug"),
            game_cover_url: row.get("game_cover_url"),
            achievement_name: row.get("achievement_name"),
            achievement_icon_url: row.get("achievement_icon_url"),
            trophy_type: row.get("trophy_type"),
            unlocked_at: row.get("unlocked_at"),
            rarity: row.get("rarity"),
        })
        .collect())
}

/// Classement des chasseurs, par points et succès débloqués.
#[tauri::command]
#[specta::specta]
pub async fn get_leaderboard(
    db: State<'_, Database>,
    limit: Option<i32>,
) -> AppResult<Vec<LeaderboardEntry>> {
    let limit = limit.unwrap_or(10).clamp(1, 100);

    let rows = sqlx::query(
        r#"
        SELECT
            COALESCE(NULLIF(u.display_name, ''), u.username) AS username,
            MAX(pa.avatar_url) AS avatar_url,
            COUNT(ua.id) AS unlocked,
            SUM(CASE WHEN a.is_platinum = 1 THEN 1 ELSE 0 END) AS platinums,
            COALESCE(SUM(a.points), 0) AS points
        FROM users u
        JOIN user_achievements ua ON ua.user_id = u.id
        JOIN achievements a ON a.id = ua.achievement_id
        LEFT JOIN platform_accounts pa ON pa.user_id = u.id
        GROUP BY u.id
        ORDER BY points DESC, unlocked DESC
        LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(&db.pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| LeaderboardEntry {
            username: row.get("username"),
            avatar_url: row.get("avatar_url"),
            unlocked: row.get("unlocked"),
            platinums: row.get("platinums"),
            points: row.get("points"),
        })
        .collect())
}
