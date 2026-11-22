//! El hilo de sincronización. Corre aparte de la UI para que un ciclo lento no
//! congele la ventana, y expone su estado por un `Mutex<Status>` que la UI lee.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::auth;
use crate::backend::FirestoreBackend;
use crate::error::Result;
use crate::sync::{cycle, SyncReport};

#[derive(Debug, Clone, Default, Serialize)]
pub struct Status {
    pub running: bool,
    pub auto: bool,
    pub interval_secs: u64,
    pub vault: Option<String>,
    pub logged_in: bool,
    pub uid: Option<String>,
    pub syncing: bool,
    pub last_sync: Option<u64>,
    pub last_error: Option<String>,
    pub last_report: Option<SyncReport>,
}

enum Command {
    Sync,
    SetAuto(bool),
    SetInterval(u64),
    SetVault(Option<PathBuf>),
    Stop,
}

pub struct Engine {
    tx: Sender<Command>,
    status: Arc<Mutex<Status>>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Engine {
    pub fn start(vault: Option<PathBuf>, auto: bool, interval_secs: u64) -> Self {
        let (tx, rx) = channel();
        let status = Arc::new(Mutex::new(Status {
            running: true,
            auto,
            interval_secs,
            vault: vault.as_ref().map(|path| path.display().to_string()),
            ..Default::default()
        }));
        refresh_identity(&status);

        let worker_status = Arc::clone(&status);
        let handle = thread::Builder::new()
            .name("mdfire-sync".into())
            .spawn(move || worker(rx, worker_status, vault, auto, interval_secs))
            .ok();

        Self { tx, status, handle }
    }

    pub fn status(&self) -> Status {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn refresh_identity(&self) {
        refresh_identity(&self.status);
    }

    pub fn sync_now(&self) -> Result<()> {
        self.send(Command::Sync)
    }

    pub fn set_auto(&self, auto: bool) -> Result<()> {
        self.send(Command::SetAuto(auto))
    }

    pub fn set_interval(&self, seconds: u64) -> Result<()> {
        self.send(Command::SetInterval(seconds))
    }

    pub fn set_vault(&self, vault: Option<PathBuf>) -> Result<()> {
        self.send(Command::SetVault(vault))
    }

    pub fn stop(&mut self) {
        let _ = self.tx.send(Command::Stop);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }

    fn send(&self, command: Command) -> Result<()> {
        self.tx
            .send(command)
            .map_err(|_| crate::error::AppError::Usage("el motor de sync no está corriendo".into()))
    }
}

fn update(status: &Arc<Mutex<Status>>, change: impl FnOnce(&mut Status)) {
    let mut guard = status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    change(&mut guard);
}

fn refresh_identity(status: &Arc<Mutex<Status>>) {
    let credentials = auth::load_credentials();
    update(status, |current| {
        current.logged_in = credentials
            .as_ref()
            .is_some_and(|credentials| credentials.has_refresh_token());
        current.uid = credentials
            .as_ref()
            .map(|credentials| credentials.uid.clone())
            .filter(|uid| !uid.is_empty());
    });
}

fn worker(
    rx: Receiver<Command>,
    status: Arc<Mutex<Status>>,
    mut vault: Option<PathBuf>,
    mut auto: bool,
    mut interval: u64,
) {
    loop {
        let command = if auto && vault.is_some() {
            match rx.recv_timeout(Duration::from_secs(interval.max(2))) {
                Ok(command) => Some(command),
                Err(RecvTimeoutError::Timeout) => Some(Command::Sync),
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.recv() {
                Ok(command) => Some(command),
                Err(_) => break,
            }
        };

        match command {
            None | Some(Command::Stop) => break,
            Some(Command::Sync) => run_sync(&status, vault.as_deref()),
            Some(Command::SetAuto(enabled)) => {
                auto = enabled;
                update(&status, |current| current.auto = enabled);
            }
            Some(Command::SetInterval(seconds)) => {
                interval = seconds.max(2);
                update(&status, |current| current.interval_secs = interval);
            }
            Some(Command::SetVault(directory)) => {
                let shown = directory.as_ref().map(|path| path.display().to_string());
                vault = directory;
                update(&status, |current| current.vault = shown);
            }
        }
    }

    update(&status, |current| {
        current.running = false;
        current.syncing = false;
    });
}

fn run_sync(status: &Arc<Mutex<Status>>, vault: Option<&Path>) {
    let Some(directory) = vault else {
        update(status, |current| {
            current.last_error = Some("Elegí una carpeta base para sincronizar".into());
        });
        return;
    };

    update(status, |current| {
        current.syncing = true;
        current.last_error = None;
    });

    let result = FirestoreBackend::open().and_then(|backend| cycle(&backend, directory));

    match result {
        Ok(report) => update(status, |current| {
            current.last_report = Some(report);
            current.last_sync = Some(now_ms());
            current.last_error = None;
        }),
        Err(error) => update(status, |current| {
            current.last_error = Some(error.to_string());
        }),
    }

    refresh_identity(status);
    update(status, |current| current.syncing = false);
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
