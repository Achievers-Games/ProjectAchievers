use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use tauri::Manager;
use std::path::PathBuf;
use anyhow::Result;
use tracing::{info, error};

pub struct Database {
    pub pool: SqlitePool,
}

impl Database {
    pub async fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let db_path = Self::get_db_path(app_handle)?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let database_url = format!("sqlite://{}?mode=rwc", db_path.display());
        info!("Connecting to database at: {}", database_url);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_lazy(&database_url)?;

        let db = Self { pool };
        db.run_migrations().await?;
        db.ensure_local_user().await?;

        Ok(db)
    }

    fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
        // Use tauri's app data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

        Ok(app_data_dir.join("project-achievers.db"))
    }

    async fn run_migrations(&self) -> Result<()> {
        // Run embedded migrations
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        info!("Database migrations completed");
        Ok(())
    }

    /// First launch has no account yet. Create a local profile so the app is
    /// usable offline; linking Steam later reuses this profile instead of
    /// creating a duplicate hunter.
    async fn ensure_local_user(&self) -> Result<()> {
        let row = sqlx::query("SELECT COUNT(*) AS count FROM users")
            .fetch_one(&self.pool)
            .await?;
        let count: i64 = row.get("count");

        if count == 0 {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO users (id, username, display_name, created_at, updated_at) \
                 VALUES (?, 'Chasseur', 'Chasseur local', ?, ?)",
            )
            .bind(&id)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
            info!("Created local profile (no linked platform yet)");
        }

        Ok(())
    }
}

// Re-export for use in commands
pub use sqlx;