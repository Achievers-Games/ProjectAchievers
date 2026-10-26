#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod commands;
mod database;
mod crypto;
mod platform;
mod error;

use commands::{
  auth::*,
  steam::*,
  psn::*,
  games::*,
  guides::*,
  comments::*,
  sync::*,
  system::*,
};
use database::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_websocket::init())
    .setup(|app| {
      // Initialize database
      let db = Database::new(app.handle()).expect("Failed to initialize database");
      app.manage(db);

      // Initialize crypto
      let crypto = crypto::Crypto::new(app.handle()).expect("Failed to initialize crypto");
      app.manage(crypto);

      // Setup system tray
      system::setup_tray(app.handle())?;

      // Register global shortcuts
      system::register_shortcuts(app.handle())?;

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      // Auth commands
      authenticate_steam,
      authenticate_psn,
      get_linked_accounts,
      unlink_account,
      get_auth_status,
      // Steam commands
      steam_get_owned_games,
      steam_get_player_achievements,
      steam_get_game_schema,
      steam_get_global_achievement_percentages,
      steam_sync_user_data,
      // PSN commands
      psn_get_trophy_titles,
      psn_get_trophy_groups,
      psn_get_trophies,
      psn_sync_user_data,
      // Games commands
      get_games,
      get_game_detail,
      search_games,
      get_user_game_progress,
      // Guides commands
      get_achievement_guides,
      create_guide,
      update_guide,
      delete_guide,
      vote_guide,
      generate_ai_guide,
      // Comments commands
      get_comments,
      create_comment,
      update_comment,
      delete_comment,
      react_to_comment,
      // Sync commands
      sync_all_platforms,
      get_sync_status,
      // System commands
      show_in_folder,
      open_external_url,
      check_for_updates,
      install_update,
      get_app_version,
      minimize_to_tray,
      show_window,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  run();
}