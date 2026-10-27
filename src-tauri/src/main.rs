#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

fn main() {
  let _ = dotenvy::from_path(".env").or_else(|_| dotenvy::from_path("src-tauri/.env"));
  project_achievers::run();
}
