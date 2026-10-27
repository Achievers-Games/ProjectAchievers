pub mod commands;
pub mod database;
pub mod crypto;
pub mod error;

use crate::commands::{
  auth::*,
  steam::*,
  psn::*,
  games::*,
  guides::*,
  comments::*,
  community::*,
  sync::*,
  system,
  system::{show_in_folder, open_external_url, check_for_updates, install_update, get_app_version, minimize_to_tray, show_window},
};
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};
use database::Database;
use tauri::Manager;

#[cfg_attr(feature = "mobile", tauri::mobile_entry_point)]
pub fn run() {
  // Specta builder: registers commands + exports TS bindings in debug builds.
  let builder = Builder::<tauri::Wry>::new()
    // Timestamps are i64 (ms since epoch); the frontend consumes them as JS numbers.
    .dangerously_cast_bigints_to_number()
    .commands(collect_commands![
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
      steam_resolve_vanity,
      // PSN commands
      psn_get_trophy_titles,
      psn_get_trophy_groups,
      psn_get_trophies,
      psn_sync_user_data,
      psn_import_from_psnprofiles,
      psn_add_manual_trophy,
      // Games commands
      get_games,
      get_game_detail,
      get_achievement_detail,
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
      trigger_background_sync,
      get_sync_history,
      force_sync_game,
      // Community commands
      get_community_feed,
      get_leaderboard,
      // System commands
      show_in_folder,
      open_external_url,
      check_for_updates,
      install_update,
      get_app_version,
      minimize_to_tray,
      show_window,
    ]);

  #[cfg(debug_assertions)]
  builder
    .export(Typescript::default(), "../src/lib/tauri-bindings.ts")
    .expect("failed to export TS bindings");

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
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| {
      let handle = app.handle();

      // Initialize database (async)
      let db = tauri::async_runtime::block_on(Database::new(handle))
        .expect("Failed to initialize database");
      app.manage(db);

      // Initialize crypto
      let crypto = crypto::Crypto::new(handle).expect("Failed to initialize crypto");
      app.manage(crypto);

      // Setup system tray
      system::setup_tray(handle)?;

      // Register global shortcuts
      system::register_shortcuts(handle)?;

      builder.mount_events(app);

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
