use sqlx::{sqlite::SqlitePoolOptions, SqlitePool, Row};
use tauri::Manager;
use std::path::PathBuf;
use directories::ProjectDirs;
use anyhow::Result;
use tracing::{info, error};

pub struct Database {
    pub pool: SqlitePool,
}

impl Database {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
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
        db.run_migrations()?;

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

    fn run_migrations(&self) -> Result<()> {
        // Run embedded migrations
        sqlx::migrate!("./migrations").run(&self.pool)?;
        info!("Database migrations completed");
        Ok(())
    }
}

// Re-export for use in commands
pub use sqlx;