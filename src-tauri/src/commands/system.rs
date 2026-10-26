use crate::error::{AppError, AppResult};
use tauri::{Manager, AppHandle, State};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AppVersion {
    pub version: String,
    pub app_name: String,
}

/// Get app version
#[tauri::command]
pub async fn get_app_version() -> AppResult<AppVersion> {
    Ok(AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
        app_name: env!("CARGO_PKG_NAME").to_string(),
    })
}

/// Open an external URL in the default browser
#[tauri::command]
pub async fn open_external_url(url: String) -> AppResult<()> {
    tauri::api::shell::open(&url, None);
    Ok(())
}

/// Show path in folder
#[tauri::command]
pub async fn show_in_folder(path: String) -> AppResult<()> {
    tauri::api::shell::reveal(&path, None);
    Ok(())
}

/// Check for updates
#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
) -> AppResult<UpdateInfo> {
    let updater = app.state::<tauri_plugin_updater::Updater>();
    match updater.check().await {
        Ok(update) => Ok(UpdateInfo {
            available: update.is_update_available,
            version: update.manifest.version.clone(),
            notes: update.manifest.notes.clone(),
            date: update.manifest.date.clone(),
        }),
        Err(e) => Err(AppError::Anyhow(anyhow::anyhow!("Update check failed: {}", e))),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Install update
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
) -> AppResult<()> {
    let updater = app.state::<tauri_plugin_updater::Updater>();
    match updater.download_and_install().await {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Anyhow(anyhow::anyhow!("Update install failed: {}", e))),
    }
}

/// Minimize window to tray
#[tauri::command]
pub async fn minimize_to_tray(
    app: AppHandle,
) -> AppResult<()> {
    let window = app.get_window("main").ok_or_else(|| AppError::NotFound("Main window not found".to_string()))?;
    window.hide()?;
    Ok(())
}

/// Show window
#[tauri::command]
pub async fn show_window(
    app: AppHandle,
) -> AppResult<()> {
    let window = app.get_window("main").ok_or_else(|| AppError::NotFound("Main window not found".to_string()))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Setup system tray
pub fn setup_tray(app: &tauri::AppHandle) -> AppResult<()> {
    use tauri::api::tray;

    // Build tray menu
    let tray_menu = tauri::menu::MenuBuilder::new(app)
        .item(&tauri::menu::MenuItemBuilder::new("Show App").build()?)
        .item(&tauri::menu::MenuItemBuilder::new("Sync").build()?)
        .item(&tauri::menu::MenuItemBuilder::separator().build()?)
        .item(&tauri::menu::MenuItemBuilder::new("Quit").build()?)
        .build()?;

    let _tray = tauri::TrayIconBuilder::new()
        .menu(&tray_menu)
        .icon(app.default_window_icon().unwrap_or_default())
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_str() {
            "Show App" => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "Sync" => {
                // Trigger sync - would emit event to frontend
                let _ = app.emit("tray-sync", {});
            }
            "Quit" => {
                std::process::exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Register global shortcuts
pub fn register_shortcuts(app: &tauri::AppHandle) -> AppResult<()> {
    use tauri_plugin_global_shortcut::ShortcutManager;

    // Register Cmd/Ctrl + Shift + A to show app
    app.global_shortcut().register("CommandOrControl+Shift+A", move |app, _| {
        let _ = app.emit("global-shortcut-show", {});
    })?;

    Ok(())
}