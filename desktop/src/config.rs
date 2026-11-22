//! Ajustes de la app, en `~/.config/mdfire/desktop.json` (misma carpeta que las
//! credenciales del CLI, para que ambos convivan).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::auth;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Carpeta base que se sincroniza.
    #[serde(default)]
    pub vault: Option<String>,
    /// Sincronizar sola cada `interval_secs`.
    #[serde(default = "default_auto")]
    pub auto: bool,
    #[serde(default = "default_interval")]
    pub interval_secs: u64,
}

fn default_auto() -> bool {
    true
}

fn default_interval() -> u64 {
    15
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            vault: None,
            auto: default_auto(),
            interval_secs: default_interval(),
        }
    }
}

pub fn load() -> Settings {
    match fs::read_to_string(auth::settings_path()) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> Result<()> {
    let path = auth::settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut raw = serde_json::to_string_pretty(settings)?;
    raw.push('\n');
    fs::write(path, raw)?;
    Ok(())
}

pub fn default_vault() -> PathBuf {
    auth::home_dir().join("mdfire-vault")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_ajustes_por_defecto_sincronizan_solos() {
        let settings = Settings::default();
        assert!(settings.auto);
        assert_eq!(settings.interval_secs, 15);
        assert!(settings.vault.is_none());
    }

    #[test]
    fn un_json_incompleto_usa_los_valores_por_defecto() {
        let settings: Settings = serde_json::from_str(r#"{"vault":"/tmp/x"}"#).unwrap();
        assert!(settings.auto);
        assert_eq!(settings.interval_secs, 15);
        assert_eq!(settings.vault.as_deref(), Some("/tmp/x"));
    }
}
