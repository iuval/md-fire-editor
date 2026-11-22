//! Ajustes de la app, en `~/.config/firemd/desktop.json` (misma carpeta que las
//! credenciales del CLI, para que ambos convivan).

use std::fs;
use std::path::{Path, PathBuf};

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
    load_from(
        &auth::settings_path(),
        &auth::legacy_config_dir().join("desktop.json"),
    )
}

/// Lee la carpeta base y el intervalo guardados. La app se llamaba mdfire, así
/// que los ajustes de antes del cambio viven un directorio al lado: se leen de
/// ahí si todavía no hay nada en la ruta nueva, para no perder la carpeta
/// configurada.
fn load_from(primary: &Path, legacy: &Path) -> Settings {
    for path in [primary, legacy] {
        if let Ok(raw) = fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str(&raw) {
                return settings;
            }
        }
    }
    Settings::default()
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
    auth::home_dir().join("firemd-vault")
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

    #[test]
    fn lee_los_ajustes_viejos_si_todavia_no_hay_nuevos() {
        let dir = std::env::temp_dir().join(format!(
            "firemd-config-legacy-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let primary = dir.join("desktop.json");
        let legacy = dir.join("legacy.json");
        fs::write(&legacy, r#"{"vault":"/tmp/viejo","interval_secs":42}"#).unwrap();

        // Sin archivo nuevo, manda el viejo.
        let settings = load_from(&primary, &legacy);
        assert_eq!(settings.vault.as_deref(), Some("/tmp/viejo"));
        assert_eq!(settings.interval_secs, 42);

        // Con archivo nuevo, manda el nuevo.
        fs::write(&primary, r#"{"vault":"/tmp/nuevo"}"#).unwrap();
        let settings = load_from(&primary, &legacy);
        assert_eq!(settings.vault.as_deref(), Some("/tmp/nuevo"));
        assert_eq!(settings.interval_secs, 15);

        let _ = fs::remove_dir_all(&dir);
    }
}
