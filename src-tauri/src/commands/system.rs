use crate::error::{AppError, AppResult};
use tauri::{Manager, AppHandle, Emitter, image::Image};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Code};
use tauri_plugin_opener::OpenerExt;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AppVersion {
    pub version: String,
    pub app_name: String,
}

/// Get app version
#[tauri::command]
#[specta::specta]
pub async fn get_app_version() -> AppResult<AppVersion> {
    Ok(AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
        app_name: env!("CARGO_PKG_NAME").to_string(),
    })
}

/// Open an external URL in the default browser
#[tauri::command]
#[specta::specta]
pub async fn open_external_url(app: AppHandle, url: String) -> AppResult<()> {
    app.opener().open_url(&url, None::<&str>)?;
    Ok(())
}

/// Show path in folder
#[tauri::command]
#[specta::specta]
pub async fn show_in_folder(app: AppHandle, path: String) -> AppResult<()> {
    app.opener().reveal_item_in_dir(&path)?;
    Ok(())
}

/// Check for updates
#[tauri::command]
#[specta::specta]
pub async fn check_for_updates(
    app: AppHandle,
) -> AppResult<UpdateInfo> {
    let updater = app.state::<tauri_plugin_updater::Updater>();
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: None,
            notes: None,
            date: None,
        }),
        Err(e) => Err(AppError::Internal(format!("Update check failed: {}", e))),
    }
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Install update
#[tauri::command]
#[specta::specta]
pub async fn install_update(
    app: AppHandle,
) -> AppResult<()> {
    let _updater = app.state::<tauri_plugin_updater::Updater>();
    // Note: In Tauri v2, the download_and_install method might not be available on the State wrapper
    // This is a simplified implementation
    Err(AppError::Internal("Auto-update not yet implemented".to_string()))
}

/// Minimize window to tray
#[tauri::command]
#[specta::specta]
pub async fn minimize_to_tray(
    app: AppHandle,
) -> AppResult<()> {
    let window = app.get_webview_window("main").ok_or_else(|| AppError::Internal("Main window not found".to_string()))?;
    window.hide()?;
    Ok(())
}

/// Show window
#[tauri::command]
#[specta::specta]
pub async fn show_window(
    app: AppHandle,
) -> AppResult<()> {
    let window = app.get_webview_window("main").ok_or_else(|| AppError::Internal("Main window not found".to_string()))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Setup system tray
pub fn setup_tray(app: &tauri::AppHandle) -> AppResult<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    // Build tray menu
    let show_item = MenuItemBuilder::new("Show App").id("show").build(app)?;
    let sync_item = MenuItemBuilder::new("Sync").id("sync").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let tray_menu = MenuBuilder::new(app)
        .items(&[&show_item, &sync_item, &separator, &quit_item])
        .build()?;

    // Try to load icon from file, fallback to default window icon
    let icon = app.default_window_icon().cloned().or_else(|| {
        // Try to load from icons directory
        let icon_path = std::path::PathBuf::from("icons/32x32.png");
        if icon_path.exists() {
            fs::read(&icon_path).ok().and_then(|bytes| {
                // Use the image crate to decode PNG and get dimensions
                if let Ok(img) = image::load_from_memory(&bytes) {
                    let rgba = img.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    // Image::new_owned is infallible and returns the image directly.
                    Some(Image::new_owned(rgba.into_raw(), width, height))
                } else {
                    None
                }
            })
        } else {
            None
        }
    });

    let _tray = TrayIconBuilder::new()
        .menu(&tray_menu)
        .icon(icon.expect("Failed to create tray icon"))
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.0.as_str() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "sync" => {
                // Trigger sync - would emit event to frontend
                let _ = app.emit("tray-sync", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Register global shortcuts
pub fn register_shortcuts(app: &tauri::AppHandle) -> AppResult<()> {
    use tauri_plugin_global_shortcut::Modifiers;

    // Register Cmd/Ctrl + Shift + A to show app (non-fatal: the combo may
    // already be held by another application).
    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyA);
    if let Err(e) = app.global_shortcut().register(shortcut) {
        tracing::warn!("Global shortcut registration failed: {}", e);
    }

    // Note: Global shortcut handler is set up differently in v2
    // The callback is typically handled via the GlobalShortcutManager

    Ok(())
}