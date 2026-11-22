//! Tipos compartidos entre el cliente de Firestore, el motor de sincronización
//! y la UI. Reflejan el modelo de datos de la app web (`src/lib/firestore.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::firestore::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    Note,
    Canvas,
}

impl NoteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteKind::Note => "note",
            NoteKind::Canvas => "canvas",
        }
    }

    pub fn from_stored(value: &str) -> Self {
        if value == "canvas" {
            NoteKind::Canvas
        } else {
            NoteKind::Note
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            NoteKind::Note => ".md",
            NoteKind::Canvas => ".canvas",
        }
    }
}

/// Carpeta remota. El ACL se guarda verbatim para copiarlo al crear una nota:
/// las reglas exigen que la nota espeje el ACL de su carpeta.
#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub acl: BTreeMap<String, Value>,
}

impl Folder {
    /// Camino completo (`GUIONES/V3`), igual que `folderNames` en el CLI.
    pub fn path(&self, all: &[Folder]) -> String {
        let mut chain = vec![self.name.clone()];
        let mut cursor = self.parent_id.clone();
        let mut guard = 0;
        while let Some(parent_id) = cursor {
            if guard > 32 {
                break;
            }
            guard += 1;
            match all.iter().find(|folder| folder.id == parent_id) {
                Some(parent) => {
                    chain.insert(0, parent.name.clone());
                    cursor = parent.parent_id.clone();
                }
                None => break,
            }
        }
        chain.join("/")
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub kind: NoteKind,
    pub version: i64,
    pub update_time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteBody {
    pub markdown: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteWrite {
    pub id: String,
    pub etag: String,
}

/// Etag = `version-sha256(markdown)[..12]`, idéntico a `etagOf` en `core.mjs`.
pub fn etag_of(markdown: &str, version: i64) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(markdown.as_bytes());
    let hash: String = digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{version}-{hash}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_etag_es_version_y_hash_corto() {
        assert_eq!(etag_of("", 0), "0-e3b0c44298fc");
        assert_eq!(etag_of("hola", 2), "2-b221d9dbb083");
        assert_eq!(etag_of("hola", 3), "3-b221d9dbb083");
    }

    #[test]
    fn el_camino_de_la_carpeta_arma_la_jerarquia() {
        let all = vec![
            Folder {
                id: "a".into(),
                name: "GUIONES".into(),
                parent_id: None,
                acl: BTreeMap::new(),
            },
            Folder {
                id: "b".into(),
                name: "V3".into(),
                parent_id: Some("a".into()),
                acl: BTreeMap::new(),
            },
        ];
        assert_eq!(all[1].path(&all), "GUIONES/V3");
        assert_eq!(all[0].path(&all), "GUIONES");
    }
}
