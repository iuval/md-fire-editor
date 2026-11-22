//! FireMD Sync: app de escritorio (Tauri) que mantiene una carpeta local
//! espejada con las notas de FireMD, en las dos direcciones.
//!
//! El motor es el mismo que usa el CLI (`agent/`): mismas reglas de Firestore,
//! mismo `.firemd/manifest.json`, mismos archivos de conflicto.

pub mod auth;
pub mod backend;
pub mod commands;
pub mod config;
pub mod engine;
pub mod error;
pub mod firestore;
pub mod link;
pub mod model;
pub mod sync;
pub mod tags;
pub mod vault;

use std::path::PathBuf;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    let settings = config::load();
    let vault = settings.vault.as_ref().map(PathBuf::from);
    let engine = engine::Engine::start(vault, settings.auto, settings.interval_secs);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::with_engine(engine))
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::sync_now,
            commands::set_auto,
            commands::set_interval,
            commands::set_vault,
            commands::pick_folder,
            commands::login,
            commands::login_account,
            commands::logout,
            commands::list_folders,
            commands::settings,
            commands::app_info,
            commands::open_folder,
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana no corta la sincronización: la app sigue en la
            // bandeja. Para salir de verdad: menú del ícono → Salir.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("no pude arrancar FireMD Sync");

    app.run(|handle, event| match event {
        RunEvent::Exit => {
            let state = handle.state::<commands::AppState>();
            state.engine().stop();
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_window(handle),
        _ => {}
    });
}

fn show_window(handle: &tauri::AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let sync = MenuItem::with_id(handle, "sync", "Sincronizar ahora", true, None::<&str>)?;
    let open = MenuItem::with_id(handle, "open", "Abrir ventana", true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[&sync, &open, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("FireMD Sync")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|handle, event| match event.id.as_ref() {
            "sync" => {
                let state = handle.state::<commands::AppState>();
                let _ = state.engine().sync_now();
            }
            "open" => show_window(handle),
            "quit" => handle.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });

    if let Some(icon) = handle.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(handle)?;
    Ok(())
}
