//! Puente entre la UI (webview) y el motor. Todo lo que la ventana puede hacer
//! pasa por acá.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::auth;
use crate::backend::{Backend, FirestoreBackend};
use crate::config::{self, Settings};
use crate::engine::{Engine, Status};
use crate::error::{AppError, Result};

pub struct AppState {
    pub engine: Mutex<Engine>,
}

impl AppState {
    pub fn with_engine(engine: Engine) -> Self {
        Self {
            engine: Mutex::new(engine),
        }
    }

    pub(crate) fn engine(&self) -> std::sync::MutexGuard<'_, Engine> {
        self.engine
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginInfo {
    pub uid: String,
    pub pairing_code: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
    pub version: String,
    pub settings_path: String,
    pub credentials_path: String,
    pub default_vault: String,
}

#[tauri::command]
pub fn status(state: State<'_, AppState>) -> Status {
    state.engine().status()
}

#[tauri::command]
pub fn sync_now(state: State<'_, AppState>) -> Result<()> {
    state.engine().sync_now()
}

#[tauri::command]
pub fn set_auto(state: State<'_, AppState>, auto: bool) -> Result<Status> {
    state.engine().set_auto(auto)?;
    persist(|settings| settings.auto = auto);
    Ok(state.engine().status())
}

#[tauri::command]
pub fn set_interval(state: State<'_, AppState>, seconds: u64) -> Result<Status> {
    let seconds = seconds.max(2);
    state.engine().set_interval(seconds)?;
    persist(|settings| settings.interval_secs = seconds);
    Ok(state.engine().status())
}

#[tauri::command]
pub fn set_vault(state: State<'_, AppState>, dir: String) -> Result<Status> {
    let path = PathBuf::from(&dir);
    if !path.is_dir() {
        return Err(AppError::Usage(format!("no existe la carpeta {dir}")));
    }
    state.engine().set_vault(Some(path))?;
    persist(|settings| settings.vault = Some(dir));
    Ok(state.engine().status())
}

/// Selector nativo de carpeta. El diálogo corre en el hilo principal y responde
/// por el canal, así que este comando no bloquea la UI.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    rx.recv().ok().flatten().map(|path| path.to_string())
}

/// Crea una cuenta anónima nueva. El uid que devuelve se pega en la app web
/// (Agentes de IA) para darle permiso sobre una carpeta.
#[tauri::command]
pub fn login(state: State<'_, AppState>) -> Result<LoginInfo> {
    let credentials = auth::login_anonymous(auth::DEFAULT_PROJECT, auth::DEFAULT_REFERER)?;
    auth::save_credentials(&credentials)?;
    state.engine().refresh_identity();
    Ok(LoginInfo {
        uid: credentials.uid.clone(),
        pairing_code: credentials.pairing_code(),
    })
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> Result<()> {
    auth::logout()?;
    state.engine().refresh_identity();
    Ok(())
}

#[tauri::command]
pub fn list_folders() -> Result<Vec<FolderInfo>> {
    let backend = FirestoreBackend::open()?;
    let folders = backend.folders()?;
    Ok(folders
        .iter()
        .map(|folder| FolderInfo {
            id: folder.id.clone(),
            name: folder.name.clone(),
            path: folder.path(&folders),
        })
        .collect())
}

#[tauri::command]
pub fn settings() -> Settings {
    config::load()
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        settings_path: auth::settings_path().display().to_string(),
        credentials_path: auth::credentials_path().display().to_string(),
        default_vault: config::default_vault().display().to_string(),
    }
}

/// Abre la carpeta en el explorador de archivos del sistema.
#[tauri::command]
pub fn open_folder(path: String) -> Result<()> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(AppError::Usage(format!("no existe la carpeta {path}")));
    }
    #[cfg(target_os = "macos")]
    let command = "open";
    #[cfg(target_os = "windows")]
    let command = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let command = "xdg-open";

    std::process::Command::new(command)
        .arg(&target)
        .spawn()
        .map_err(|error| AppError::Usage(format!("no pude abrir la carpeta: {error}")))?;
    Ok(())
}

fn persist(change: impl FnOnce(&mut Settings)) {
    let mut settings = config::load();
    change(&mut settings);
    let _ = config::save(&settings);
}
