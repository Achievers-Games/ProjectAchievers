use crate::{
    database::Database,
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AchievementGuide {
    pub id: String,
    pub achievement_id: String,
    pub author_id: String,
    pub author_username: String,
    pub author_avatar: Option<String>,
    pub content_md: String,
    pub content_type: String, // 'ai', 'community', 'official'
    pub video_url: Option<String>,
    pub images: Vec<String>,
    pub ai_generated: bool,
    pub ai_model: Option<String>,
    pub version: i32,
    pub parent_guide_id: Option<String>,
    pub status: String,
    pub verified: bool,
    pub verified_by: Option<String>,
    pub verified_at: Option<i64>,
    pub upvotes: i32,
    pub downvotes: i32,
    pub user_vote: Option<String>, // 'up', 'down', or null
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct CreateGuideRequest {
    pub achievement_id: String,
    pub content_md: String,
    pub content_type: String, // 'community'
    pub video_url: Option<String>,
    pub images: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UpdateGuideRequest {
    pub guide_id: String,
    pub content_md: Option<String>,
    pub video_url: Option<String>,
    pub images: Option<Vec<String>>,
    pub status: Option<String>, // 'draft', 'published', 'archived'
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AIGuideRequest {
    pub achievement_id: String,
    pub game_name: String,
    pub achievement_name: String,
    pub achievement_description: String,
    pub trophy_type: Option<String>,
    pub known_requirements: Option<String>,
}

/// Get all guides for an achievement
#[tauri::command]
#[specta::specta]
pub async fn get_achievement_guides(
    achievement_id: String,
    db: State<'_, Database>,
) -> AppResult<Vec<AchievementGuide>> {
    let user_id = get_current_user_id(&db).await.ok();

    let rows = sqlx::query(
        r#"
        SELECT ag.*, u.username as author_username, u.avatar_url as author_avatar,
               COUNT(CASE WHEN gv.vote_type = 'up' THEN 1 END) as upvotes,
               COUNT(CASE WHEN gv.vote_type = 'down' THEN 1 END) as downvotes
        FROM achievement_guides ag
        JOIN users u ON u.id = ag.author_id
        LEFT JOIN guide_votes gv ON gv.guide_id = ag.id
        WHERE ag.achievement_id = ? AND ag.status = 'published'
        GROUP BY ag.id
        ORDER BY (COUNT(CASE WHEN gv.vote_type = 'up' THEN 1 END) - COUNT(CASE WHEN gv.vote_type = 'down' THEN 1 END)) DESC, ag.created_at DESC
        "#
    )
    .bind(&achievement_id)
    .fetch_all(&db.pool)
    .await?;

    let mut guides = Vec::new();
    for row in rows {
        let guide_id: String = row.get("id");
        let user_vote = if let Some(uid) = &user_id {
            sqlx::query("SELECT vote_type FROM guide_votes WHERE guide_id = ? AND user_id = ?")
                .bind(&guide_id)
                .bind(uid)
                .fetch_optional(&db.pool)
                .await?
                .map(|r| r.get("vote_type"))
        } else {
            None
        };

        let images: Vec<String> = serde_json::from_str(
            row.get::<Option<String>, _>("images_json").as_deref().unwrap_or("[]")
        ).unwrap_or_default();

        guides.push(AchievementGuide {
            id: row.get("id"),
            achievement_id: row.get("achievement_id"),
            author_id: row.get("author_id"),
            author_username: row.get("author_username"),
            author_avatar: row.get("author_avatar"),
            content_md: row.get("content_md"),
            content_type: row.get("content_type"),
            video_url: row.get("video_url"),
            images,
            ai_generated: row.get("ai_generated"),
            ai_model: row.get("ai_model"),
            version: row.get("version"),
            parent_guide_id: row.get("parent_guide_id"),
            status: row.get("status"),
            verified: row.get("verified"),
            verified_by: row.get("verified_by"),
            verified_at: row.get("verified_at"),
            upvotes: row.get("upvotes"),
            downvotes: row.get("downvotes"),
            user_vote,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });
    }

    Ok(guides)
}

/// Create a new community guide
#[tauri::command]
#[specta::specta]
pub async fn create_guide(
    request: CreateGuideRequest,
    db: State<'_, Database>,
) -> AppResult<AchievementGuide> {
    let user_id = get_current_user_id(&db).await?;
    let guide_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO achievement_guides (id, achievement_id, author_id, content_md, content_type, video_url, images_json, ai_generated, version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 1, 'published', ?, ?)
        "#,
    )
    .bind(&guide_id)
    .bind(&request.achievement_id)
    .bind(&user_id)
    .bind(&request.content_md)
    .bind(&request.content_type)
    .bind(&request.video_url)
    .bind(serde_json::to_string(&request.images)?)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    // Return the created guide
    get_guide_by_id(&db, &guide_id, Some(user_id.as_str())).await
}

/// Update an existing guide (creates new version)
#[tauri::command]
#[specta::specta]
pub async fn update_guide(
    request: UpdateGuideRequest,
    db: State<'_, Database>,
) -> AppResult<AchievementGuide> {
    let user_id = get_current_user_id(&db).await?;

    // Get current guide
    let current = sqlx::query("SELECT * FROM achievement_guides WHERE id = ?")
        .bind(&request.guide_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Guide not found"))?;

    // Check ownership
    let author_id: String = current.get("author_id");
    if author_id != user_id {
        return Err(anyhow::anyhow!("You can only edit your own guides").into());
    }

    let new_version: i32 = current.get::<i32, _>("version") + 1;
    let now = Utc::now().timestamp_millis();

    // Create new version
    let new_guide_id = Uuid::new_v4().to_string();
    let content_md = request.content_md.unwrap_or_else(|| current.get("content_md"));
    let video_url = request.video_url.or_else(|| current.get("video_url"));
    let images = request.images.unwrap_or_else(|| {
        serde_json::from_str(
            current.get::<Option<String>, _>("images_json").as_deref().unwrap_or("[]")
        ).unwrap_or_default()
    });
    let status = request.status.unwrap_or_else(|| current.get("status"));

    sqlx::query(
        r#"
        INSERT INTO achievement_guides (id, achievement_id, author_id, content_md, content_type, video_url, images_json, ai_generated, version, parent_guide_id, status, created_at, updated_at)
        SELECT ?, achievement_id, author_id, ?, content_type, ?, ?, ai_generated, ?, id, ?, ?, ?
        FROM achievement_guides WHERE id = ?
        "#,
    )
    .bind(&new_guide_id)
    .bind(&content_md)
    .bind(&video_url)
    .bind(serde_json::to_string(&images)?)
    .bind(&new_version)
    .bind(&status)
    .bind(&now)
    .bind(&now)
    .bind(&request.guide_id)
    .execute(&db.pool)
    .await?;

    // Archive old version
    sqlx::query("UPDATE achievement_guides SET status = 'archived' WHERE id = ?")
        .bind(&request.guide_id)
        .execute(&db.pool)
        .await?;

    get_guide_by_id(&db, &new_guide_id, Some(&user_id)).await
}

/// Delete a guide
#[tauri::command]
#[specta::specta]
pub async fn delete_guide(
    guide_id: String,
    db: State<'_, Database>,
) -> AppResult<()> {
    let user_id = get_current_user_id(&db).await?;

    let row = sqlx::query("SELECT author_id FROM achievement_guides WHERE id = ?")
        .bind(&guide_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Guide not found"))?;

    let author_id: String = row.get("author_id");
    if author_id != user_id {
        return Err(anyhow::anyhow!("You can only delete your own guides").into());
    }

    sqlx::query("DELETE FROM achievement_guides WHERE id = ?")
        .bind(&guide_id)
        .execute(&db.pool)
        .await?;

    Ok(())
}

/// Vote on a guide
#[tauri::command]
#[specta::specta]
pub async fn vote_guide(
    guide_id: String,
    vote_type: String, // 'up' or 'down'
    db: State<'_, Database>,
) -> AppResult<VoteResult> {
    let user_id = get_current_user_id(&db).await?;

    if vote_type != "up" && vote_type != "down" {
        return Err(anyhow::anyhow!("Vote type must be 'up' or 'down'").into());
    }

    // Check if guide exists
    let guide_exists = sqlx::query("SELECT 1 FROM achievement_guides WHERE id = ?")
        .bind(&guide_id)
        .fetch_optional(&db.pool)
        .await?
        .is_some();

    if !guide_exists {
        return Err(anyhow::anyhow!("Guide not found").into());
    }

    // Upsert vote
    sqlx::query(
        r#"
        INSERT INTO guide_votes (id, guide_id, user_id, vote_type, created_at)
        VALUES (?, ?, ?, ?, strftime('%s', 'now') * 1000)
        ON CONFLICT(guide_id, user_id) DO UPDATE SET
            vote_type = excluded.vote_type
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&guide_id)
    .bind(&user_id)
    .bind(&vote_type)
    .execute(&db.pool)
    .await?;

    // Get updated counts
    let row = sqlx::query(
        "SELECT COUNT(CASE WHEN vote_type = 'up' THEN 1 END) as upvotes, COUNT(CASE WHEN vote_type = 'down' THEN 1 END) as downvotes FROM guide_votes WHERE guide_id = ?"
    )
    .bind(&guide_id)
    .fetch_one(&db.pool)
    .await?;

    Ok(VoteResult {
        upvotes: row.get("upvotes"),
        downvotes: row.get("downvotes"),
        user_vote: Some(vote_type),
    })
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct VoteResult {
    pub upvotes: i64,
    pub downvotes: i64,
    pub user_vote: Option<String>,
}

/// Generate AI guide for an achievement
#[tauri::command]
#[specta::specta]
pub async fn generate_ai_guide(
    request: AIGuideRequest,
    db: State<'_, Database>,
) -> AppResult<AchievementGuide> {
    let user_id = get_current_user_id(&db).await?;

    // Build prompt for AI
    let prompt = build_ai_prompt(&request);

    // Call AI (local or API)
    let ai_content = call_ai_model(&prompt).await?;

    // Save as AI guide
    let guide_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO achievement_guides (id, achievement_id, author_id, content_md, content_type, ai_generated, ai_model, version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ai', TRUE, 'local-llm', 1, 'published', ?, ?)
        "#,
    )
    .bind(&guide_id)
    .bind(&request.achievement_id)
    .bind(&user_id)
    .bind(&ai_content)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    get_guide_by_id(&db, &guide_id, Some(&user_id)).await
}

fn build_ai_prompt(request: &AIGuideRequest) -> String {
    format!(
        r#"You are an expert achievement hunter. Write a concise, helpful guide for unlocking this achievement.

Game: {}
Achievement: {}
Description: {}
Trophy Type: {}
Known Requirements: {}

Write a guide in Markdown format with these sections:
## Overview
Brief summary of what the achievement requires.

## Step-by-Step Guide
Numbered steps to unlock the achievement.

## Tips & Strategies
Helpful tips, missables warnings, difficulty notes.

## Estimated Time
How long it typically takes.

## Difficulty
Rate 1-10 with explanation.

Keep it concise but comprehensive. Use formatting for readability."#,
        request.game_name,
        request.achievement_name,
        request.achievement_description,
        request.trophy_type.as_deref().unwrap_or("Unknown"),
        request.known_requirements.as_deref().unwrap_or("None known")
    )
}

async fn call_ai_model(_prompt: &str) -> AppResult<String> {
    // In a real implementation, this would call a local LLM (llama.cpp) or an API
    // For now, return a template response

    // TODO: Integrate with llama.cpp or external API
    Ok(format!(
        r#"## Overview
This is an AI-generated guide placeholder. In the full implementation, this would be generated by a local LLM (like Phi-3-mini via llama.cpp) or a cloud API.

## Step-by-Step Guide
1. **Step 1**: Placeholder step - replace with actual requirements
2. **Step 2**: Continue with specific game mechanics
3. **Step 3**: Complete the final requirement

## Tips & Strategies
- **Missables**: Watch for any missable content
- **Difficulty**: Adjust based on your playstyle
- **Co-op**: Check if multiplayer is required

## Estimated Time
- **Main Story**: ~X hours
- **100% Completion**: ~Y hours

## Difficulty
**5/10** - Moderate difficulty, requires some skill/knowledge

---
*This guide was generated by AI. Community verification recommended.*"#
    ))
}

async fn get_guide_by_id(db: &Database, guide_id: &str, user_id: Option<&str>) -> AppResult<AchievementGuide> {
    let row = sqlx::query(
        r#"
        SELECT ag.*, u.username as author_username, u.avatar_url as author_avatar,
               COUNT(CASE WHEN gv.vote_type = 'up' THEN 1 END) as upvotes,
               COUNT(CASE WHEN gv.vote_type = 'down' THEN 1 END) as downvotes
        FROM achievement_guides ag
        JOIN users u ON u.id = ag.author_id
        LEFT JOIN guide_votes gv ON gv.guide_id = ag.id
        WHERE ag.id = ?
        GROUP BY ag.id
        "#
    )
    .bind(guide_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Guide not found"))?;

    let user_vote = if let Some(uid) = user_id {
        sqlx::query("SELECT vote_type FROM guide_votes WHERE guide_id = ? AND user_id = ?")
            .bind(guide_id)
            .bind(uid)
            .fetch_optional(&db.pool)
            .await?
            .map(|r| r.get("vote_type"))
    } else {
        None
    };

    let images: Vec<String> = serde_json::from_str(
        row.get::<Option<String>, _>("images_json").as_deref().unwrap_or("[]")
    ).unwrap_or_default();

    Ok(AchievementGuide {
        id: row.get("id"),
        achievement_id: row.get("achievement_id"),
        author_id: row.get("author_id"),
        author_username: row.get("author_username"),
        author_avatar: row.get("author_avatar"),
        content_md: row.get("content_md"),
        content_type: row.get("content_type"),
        video_url: row.get("video_url"),
        images,
        ai_generated: row.get("ai_generated"),
        ai_model: row.get("ai_model"),
        version: row.get("version"),
        parent_guide_id: row.get("parent_guide_id"),
        status: row.get("status"),
        verified: row.get("verified"),
        verified_by: row.get("verified_by"),
        verified_at: row.get("verified_at"),
        upvotes: row.get("upvotes"),
        downvotes: row.get("downvotes"),
        user_vote,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

async fn get_current_user_id(db: &Database) -> AppResult<String> {
    let row = sqlx::query("SELECT id FROM users LIMIT 1")
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Internal("No user found".to_string()))?;

    Ok(row.get("id"))
}