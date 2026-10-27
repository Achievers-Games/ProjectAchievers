use crate::{
    database::Database,
    error::{AppError, AppResult, TauriResult},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct Comment {
    pub id: String,
    pub achievement_id: String,
    pub user_id: String,
    pub username: String,
    pub avatar_url: Option<String>,
    pub content_md: String,
    pub parent_id: Option<String>,
    pub depth: i32,
    pub reactions: CommentReactions,
    pub user_reaction: Option<String>,
    pub reply_count: i32,
    pub is_deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub replies: Option<Vec<Comment>>,
}

#[derive(Debug, Serialize, Deserialize, Default, specta::Type)]
pub struct CommentReactions {
    pub helpful: i32,
    pub funny: i32,
    pub thanks: i32,
    pub heart: i32,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct CreateCommentRequest {
    pub achievement_id: String,
    pub content_md: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UpdateCommentRequest {
    pub comment_id: String,
    pub content_md: String,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ReactionRequest {
    pub comment_id: String,
    pub reaction_type: String, // 'helpful', 'funny', 'thanks', 'heart'
}

/// Get comments for an achievement (threaded)
#[tauri::command]
#[specta::specta]
pub async fn get_comments(
    achievement_id: String,
    limit: Option<i32>,
    offset: Option<i32>,
    db: State<'_, Database>,
) -> AppResult<Vec<Comment>> {
    let user_id = get_current_user_id(&db).await.ok();
    let lim = limit.unwrap_or(50);
    let off = offset.unwrap_or(0);

    // Get top-level comments
    let rows = sqlx::query(
        r#"
        SELECT c.*, u.username, u.avatar_url,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'helpful') as helpful,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'funny') as funny,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'thanks') as thanks,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'heart') as heart,
               (SELECT COUNT(*) FROM comments WHERE parent_id = c.id AND is_deleted = FALSE) as reply_count
        FROM comments c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN comment_reactions cr ON cr.comment_id = c.id
        WHERE c.achievement_id = ? AND c.parent_id IS NULL AND c.is_deleted = FALSE
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
        "#
    )
    .bind(&achievement_id)
    .bind(lim)
    .bind(off)
    .fetch_all(&db.pool)
    .await?;

    let mut comments = Vec::new();
    for row in rows {
        let comment = build_comment(&db, &row, &user_id, 0).await?;
        comments.push(comment);
    }

    Ok(comments)
}

async fn build_comment(
    db: &Database,
    row: &sqlx::sqlite::SqliteRow,
    user_id: &Option<String>,
    depth: i32,
) -> AppResult<Comment> {
    let comment_id: String = row.get("id");
    let is_deleted: bool = row.get("is_deleted");

    let content = if is_deleted {
        "[Deleted]".to_string()
    } else {
        row.get("content_md")
    };

    let user_reaction = if let Some(uid) = user_id {
        sqlx::query("SELECT reaction_type FROM comment_reactions WHERE comment_id = ? AND user_id = ?")
            .bind(&comment_id)
            .bind(uid)
            .fetch_optional(&db.pool)
            .await?
            .map(|r| r.get("reaction_type"))
    } else {
        None
    };

    let reactions = CommentReactions {
        helpful: row.get("helpful"),
        funny: row.get("funny"),
        thanks: row.get("thanks"),
        heart: row.get("heart"),
    };

    // Get replies if not too deep
    let replies = if depth < 3 && !is_deleted {
        let reply_rows = sqlx::query(
            r#"
            SELECT c.*, u.username, u.avatar_url,
                   COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'helpful') as helpful,
                   COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'funny') as funny,
                   COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'thanks') as thanks,
                   COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'heart') as heart,
                   (SELECT COUNT(*) FROM comments WHERE parent_id = c.id AND is_deleted = FALSE) as reply_count
            FROM comments c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN comment_reactions cr ON cr.comment_id = c.id
            WHERE c.parent_id = ? AND c.is_deleted = FALSE
            GROUP BY c.id
            ORDER BY c.created_at ASC
            "#
        )
        .bind(&comment_id)
        .fetch_all(&db.pool)
        .await?;

        let mut reply_comments = Vec::new();
        for r in reply_rows {
            reply_comments.push(Box::pin(build_comment(db, &r, user_id, depth + 1)).await?);
        }
        Some(reply_comments)
    } else {
        None
    };

    Ok(Comment {
        id: comment_id,
        achievement_id: row.get("achievement_id"),
        user_id: row.get("user_id"),
        username: row.get("username"),
        avatar_url: row.get("avatar_url"),
        content_md: content,
        parent_id: row.get("parent_id"),
        depth,
        reactions,
        user_reaction,
        reply_count: row.get("reply_count"),
        is_deleted,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        replies,
    })
}

/// Create a new comment
#[tauri::command]
#[specta::specta]
pub async fn create_comment(
    request: CreateCommentRequest,
    db: State<'_, Database>,
) -> AppResult<Comment> {
    if request.content_md.trim().is_empty() {
        return Err(anyhow::anyhow!("Comment cannot be empty").into());
    }

    let user_id = get_current_user_id(&db).await?;
    let comment_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    // Validate parent if provided
    if let Some(parent_id) = &request.parent_id {
        let parent = sqlx::query("SELECT id, depth FROM comments WHERE id = ?")
            .bind(parent_id)
            .fetch_optional(&db.pool)
            .await?;

        if parent.is_none() {
            return Err(anyhow::anyhow!("Parent comment not found").into());
        }

        let parent_depth: i32 = parent.unwrap().get("depth");
        if parent_depth >= 3 {
            return Err(anyhow::anyhow!("Maximum reply depth reached").into());
        }
    }

    sqlx::query(
        r#"
        INSERT INTO comments (id, achievement_id, user_id, content_md, parent_id, depth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, COALESCE((SELECT depth FROM comments WHERE id = ?) + 1, 0), ?, ?)
        "#,
    )
    .bind(&comment_id)
    .bind(&request.achievement_id)
    .bind(&user_id)
    .bind(&request.content_md)
    .bind(&request.parent_id)
    .bind(&request.parent_id)
    .bind(&now)
    .bind(&now)
    .execute(&db.pool)
    .await?;

    // Get the created comment
    get_comment_by_id(&db, &comment_id, Some(&user_id)).await
}

/// Update a comment
#[tauri::command]
#[specta::specta]
pub async fn update_comment(
    request: UpdateCommentRequest,
    db: State<'_, Database>,
) -> AppResult<Comment> {
    let user_id = get_current_user_id(&db).await?;

    let row = sqlx::query("SELECT user_id FROM comments WHERE id = ?")
        .bind(&request.comment_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Comment not found"))?;

    let author_id: String = row.get("user_id");
    if author_id != user_id {
        return Err(anyhow::anyhow!("You can only edit your own comments").into());
    }

    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "UPDATE comments SET content_md = ?, updated_at = ? WHERE id = ?"
    )
    .bind(&request.content_md)
    .bind(&now)
    .bind(&request.comment_id)
    .execute(&db.pool)
    .await?;

    get_comment_by_id(&db, &request.comment_id, Some(&user_id)).await
}

/// Delete a comment (soft delete)
#[tauri::command]
#[specta::specta]
pub async fn delete_comment(
    comment_id: String,
    db: State<'_, Database>,
) -> AppResult<()> {
    let user_id = get_current_user_id(&db).await?;

    let row = sqlx::query("SELECT user_id FROM comments WHERE id = ?")
        .bind(&comment_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Comment not found"))?;

    let author_id: String = row.get("user_id");
    if author_id != user_id {
        return Err(anyhow::anyhow!("You can only delete your own comments").into());
    }

    sqlx::query("UPDATE comments SET is_deleted = TRUE, updated_at = ? WHERE id = ?")
        .bind(Utc::now().timestamp_millis())
        .bind(&comment_id)
        .execute(&db.pool)
        .await?;

    Ok(())
}

/// React to a comment
#[tauri::command]
#[specta::specta]
pub async fn react_to_comment(
    request: ReactionRequest,
    db: State<'_, Database>,
) -> AppResult<CommentReactions> {
    let user_id = get_current_user_id(&db).await?;

    let valid_reactions = ["helpful", "funny", "thanks", "heart"];
    if !valid_reactions.contains(&request.reaction_type.as_str()) {
        return Err(anyhow::anyhow!("Invalid reaction type").into());
    }

    // Check comment exists
    let comment_exists = sqlx::query("SELECT 1 FROM comments WHERE id = ? AND is_deleted = FALSE")
        .bind(&request.comment_id)
        .fetch_optional(&db.pool)
        .await?
        .is_some();

    if !comment_exists {
        return Err(anyhow::anyhow!("Comment not found").into());
    }

    // Toggle reaction (add if not exists, remove if same, change if different)
    let existing = sqlx::query(
        "SELECT reaction_type FROM comment_reactions WHERE comment_id = ? AND user_id = ?"
    )
    .bind(&request.comment_id)
    .bind(&user_id)
    .fetch_optional(&db.pool)
    .await?;

    if let Some(row) = existing {
        let existing_type: String = row.get("reaction_type");
        if existing_type == request.reaction_type {
            // Remove reaction (toggle off)
            sqlx::query(
                "DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?"
            )
            .bind(&request.comment_id)
            .bind(&user_id)
            .execute(&db.pool)
            .await?;
        } else {
            // Change reaction
            sqlx::query(
                "UPDATE comment_reactions SET reaction_type = ? WHERE comment_id = ? AND user_id = ?"
            )
            .bind(&request.reaction_type)
            .bind(&request.comment_id)
            .bind(&user_id)
            .execute(&db.pool)
            .await?;
        }
    } else {
        // Add new reaction
        sqlx::query(
            r#"
            INSERT INTO comment_reactions (id, comment_id, user_id, reaction_type, created_at)
            VALUES (?, ?, ?, ?, strftime('%s', 'now') * 1000)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&request.comment_id)
        .bind(&user_id)
        .bind(&request.reaction_type)
        .execute(&db.pool)
        .await?;
    }

    // Return updated counts
    let row = sqlx::query(
        r#"
        SELECT
            COUNT(CASE WHEN reaction_type = 'helpful' THEN 1 END) as helpful,
            COUNT(CASE WHEN reaction_type = 'funny' THEN 1 END) as funny,
            COUNT(CASE WHEN reaction_type = 'thanks' THEN 1 END) as thanks,
            COUNT(CASE WHEN reaction_type = 'heart' THEN 1 END) as heart
        FROM comment_reactions WHERE comment_id = ?
        "#
    )
    .bind(&request.comment_id)
    .fetch_one(&db.pool)
    .await?;

    Ok(CommentReactions {
        helpful: row.get("helpful"),
        funny: row.get("funny"),
        thanks: row.get("thanks"),
        heart: row.get("heart"),
    })
}

async fn get_comment_by_id(db: &Database, comment_id: &str, user_id: Option<&str>) -> AppResult<Comment> {
    let row = sqlx::query(
        r#"
        SELECT c.*, u.username, u.avatar_url,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'helpful') as helpful,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'funny') as funny,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'thanks') as thanks,
               COUNT(cr.id) FILTER (WHERE cr.reaction_type = 'heart') as heart,
               (SELECT COUNT(*) FROM comments WHERE parent_id = c.id AND is_deleted = FALSE) as reply_count
        FROM comments c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN comment_reactions cr ON cr.comment_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
        "#
    )
    .bind(comment_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::Internal("Comment not found".to_string()))?;

    build_comment(db, &row, &user_id.map(|s| s.to_string()), 0).await
}

async fn get_current_user_id(db: &Database) -> AppResult<String> {
    let row = sqlx::query("SELECT id FROM users LIMIT 1")
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::Internal("No user found".to_string()))?;

    Ok(row.get("id"))
}