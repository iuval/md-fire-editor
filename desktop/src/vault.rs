//! La carpeta local: nombres seguros, manifiesto `.mdfire/manifest.json` y
//! recorrido de archivos. Compatible con el que escribe `agent/vault.mjs`, así
//! que el CLI y la app de escritorio pueden usarse sobre la misma carpeta.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

pub const MANIFEST_DIR: &str = ".mdfire";
pub const MANIFEST_FILE: &str = ".mdfire/manifest.json";

/// Nombres de archivo seguros en Windows y macOS a la vez. Espejo de `safeName`.
pub fn safe_name(name: &str, fallback: &str) -> String {
    let mut clean = String::with_capacity(name.len());
    for character in name.chars() {
        if matches!(
            character,
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        ) || character.is_control()
        {
            clean.push('-');
        } else {
            clean.push(character);
        }
    }
    let collapsed = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed.chars().take(80).collect();
    let trimmed = trimmed.trim().to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

/// `<nota>.conflicto-AAAAAMMDDHHMM.md` al lado del original.
pub fn conflict_path(path: &str, stamp: &str) -> String {
    match path.rsplit_once('.') {
        Some((stem, extension)) => format!("{stem}.conflicto-{stamp}.{extension}"),
        None => format!("{path}.conflicto-{stamp}"),
    }
}

/// Marca de tiempo UTC en el formato del CLI: `202601151430`.
pub fn stamp_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    stamp_from_epoch(seconds)
}

pub fn stamp_from_epoch(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let remainder = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}{month:02}{day:02}{:02}{:02}",
        remainder / 3600,
        (remainder % 3600) / 60
    )
}

/// Algoritmo de Howard Hinnant: días desde 1970 → (año, mes, día).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    (
        year + if month <= 2 { 1 } else { 0 },
        month as u32,
        day as u32,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub id: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    /// Mtime en milisegundos de la última sincronización de este archivo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime: Option<f64>,
    /// Hash del contenido con el que se sincronizó. El CLI no lo usa (se apoya en
    /// el mtime), pero detecta ediciones aunque el mtime se conserve.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl ManifestEntry {
    pub fn new(
        id: impl Into<String>,
        etag: Option<String>,
        path: &str,
        mtime: Option<f64>,
    ) -> Self {
        Self {
            id: id.into(),
            etag,
            path: Some(path.to_string()),
            mtime,
            sha: None,
            extra: serde_json::Map::new(),
        }
    }

    pub fn with_sha(mut self, sha: Option<String>) -> Self {
        self.sha = sha;
        self
    }
}

/// Hash corto del contenido, igual al de `etagOf` (12 hex).
pub fn content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub files: BTreeMap<String, ManifestEntry>,
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            version: 1,
            files: BTreeMap::new(),
        }
    }
}

impl Manifest {
    pub fn get(&self, path: &str) -> Option<&ManifestEntry> {
        self.files.get(path)
    }

    pub fn insert(&mut self, path: &str, entry: ManifestEntry) {
        self.files.insert(path.to_string(), entry);
    }
}

pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(MANIFEST_DIR).join("manifest.json")
}

pub fn read_manifest(root: &Path) -> Manifest {
    match fs::read_to_string(manifest_path(root)) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Manifest::default(),
    }
}

pub fn write_manifest(root: &Path, manifest: &Manifest) -> Result<()> {
    let path = manifest_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut body = serde_json::to_string_pretty(manifest)?;
    body.push('\n');
    fs::write(path, body)?;
    Ok(())
}

/// Archivos sincronizables: `.md` y `.canvas`, nunca dentro de carpetas ocultas.
pub fn list_markdown(root: &Path) -> Result<Vec<String>> {
    let mut found = Vec::new();
    walk(root, root, &mut found)?;
    found.sort();
    Ok(found)
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) -> Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            walk(&path, base, out)?;
        } else if is_syncable(&name) {
            if let Ok(relative) = path.strip_prefix(base) {
                out.push(to_slash(relative));
            }
        }
    }
    Ok(())
}

pub fn is_syncable(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".canvas")
}

/// Un `.conflicto-…` es trabajo local sin resolver: no se sube como nota nueva.
pub fn is_conflict_copy(name: &str) -> bool {
    name.contains(".conflicto-")
}

pub fn to_slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn from_slash(path: &str) -> PathBuf {
    let mut buffer = PathBuf::new();
    for segment in path.split('/') {
        buffer.push(segment);
    }
    buffer
}

/// Mtime en milisegundos, como `info.mtimeMs` en Node.
pub fn file_mtime_ms(path: &Path) -> Option<f64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_nombres_se_sanitizan_igual_que_en_el_cli() {
        assert_eq!(
            safe_name("Nota: con / barras", "sin-titulo"),
            "Nota- con - barras"
        );
        assert_eq!(safe_name("  varios   espacios  ", "x"), "varios espacios");
        assert_eq!(safe_name("", "sin-titulo"), "sin-titulo");
        assert_eq!(safe_name("   ", "sin-titulo"), "sin-titulo");
        let long = "a".repeat(120);
        assert_eq!(safe_name(&long, "x").chars().count(), 80);
    }

    #[test]
    fn el_archivo_de_conflicto_va_al_lado() {
        assert_eq!(
            conflict_path("GUIONES/Nota.md", "202601151430"),
            "GUIONES/Nota.conflicto-202601151430.md"
        );
        assert_eq!(
            conflict_path("tablero.canvas", "202601151430"),
            "tablero.conflicto-202601151430.canvas"
        );
    }

    #[test]
    fn la_marca_de_tiempo_es_utc_y_compacta() {
        assert_eq!(stamp_from_epoch(0), "197001010000");
        assert_eq!(stamp_from_epoch(1_767_225_600), "202601010000");
        assert_eq!(
            stamp_from_epoch(1_767_225_600 + 14 * 3600 + 30 * 60),
            "202601011430"
        );
        assert_eq!(stamp_now().len(), 12);
    }

    #[test]
    fn el_manifiesto_hace_round_trip_y_conserva_campos_desconocidos() {
        let raw = r#"{
          "version": 1,
          "files": {
            "GUIONES/Nota.md": {
              "id": "abc123",
              "etag": "2-aaaa",
              "path": "GUIONES/Nota.md",
              "mtime": 1700000000000.5,
              "algoDelCli": true
            }
          }
        }"#;
        let manifest: Manifest = serde_json::from_str(raw).unwrap();
        let entry = manifest.get("GUIONES/Nota.md").unwrap();
        assert_eq!(entry.id, "abc123");
        assert_eq!(entry.etag.as_deref(), Some("2-aaaa"));
        assert_eq!(entry.mtime, Some(1_700_000_000_000.5));
        assert_eq!(
            entry.extra.get("algoDelCli").and_then(|v| v.as_bool()),
            Some(true)
        );

        let serialized = serde_json::to_string(&manifest).unwrap();
        assert!(serialized.contains("algoDelCli"));
    }

    #[test]
    fn el_hash_de_contenido_coincide_con_el_del_etag() {
        assert_eq!(content_hash(""), "e3b0c44298fc");
        assert_eq!(content_hash("hola"), "b221d9dbb083");
    }

    #[test]
    fn un_manifiesto_ausente_es_uno_vacio() {
        let manifest = Manifest::default();
        assert_eq!(manifest.version, 1);
        assert!(manifest.files.is_empty());
    }

    #[test]
    fn solo_se_sincronizan_md_y_canvas() {
        assert!(is_syncable("Nota.MD"));
        assert!(is_syncable("tablero.canvas"));
        assert!(!is_syncable("imagen.png"));
        assert!(!is_syncable("datos.json"));
    }

    #[test]
    fn las_copias_de_conflicto_no_se_suben() {
        assert!(is_conflict_copy("Nota.conflicto-202601151430.md"));
        assert!(!is_conflict_copy("Nota.md"));
    }
}
