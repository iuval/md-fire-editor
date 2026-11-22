//! El contrato entre el motor de sincronización y la nube, y su implementación
//! real sobre Firestore REST.
//!
//! El motor sólo conoce este trait, así que los tests corren contra un backend en
//! memoria: nada de red, mismo comportamiento.

use std::collections::BTreeMap;

use crate::auth;
use crate::error::{AppError, Result};
use crate::firestore::{Document, Query, RestStore, Transform, Value, Write};
use crate::model::{etag_of, Folder, NoteBody, NoteKind, NoteMeta, NoteWrite};
use crate::tags::extract_tags;

pub trait Backend {
    fn uid(&self) -> &str;
    fn folders(&self) -> Result<Vec<Folder>>;
    fn notes(&self) -> Result<Vec<NoteMeta>>;
    fn note(&self, id: &str) -> Result<Option<NoteMeta>>;
    fn read_body(&self, note: &NoteMeta) -> Result<NoteBody>;
    /// Reemplaza el cuerpo completo. `expected_etag` es el que tenía el archivo
    /// cuando se trajo: si la nube cambió, falla con `AppError::Etag`.
    fn replace_body(
        &self,
        note: &NoteMeta,
        markdown: &str,
        expected_etag: Option<&str>,
    ) -> Result<NoteWrite>;
    fn create_note(
        &self,
        folder: &Folder,
        title: &str,
        body: &str,
        kind: NoteKind,
    ) -> Result<NoteWrite>;
}

/// Límites y validación de cuerpos, iguales a `core.mjs`.
pub fn validate_body(kind: NoteKind, markdown: &str) -> Result<()> {
    let length = markdown.chars().count();
    match kind {
        NoteKind::Canvas => {
            let parsed: serde_json::Value = serde_json::from_str(markdown)
                .map_err(|_| AppError::Usage("un canvas tiene que ser JSON válido".into()))?;
            let object = parsed.as_object().ok_or_else(|| {
                AppError::Usage("un canvas tiene que ser un objeto JSON Canvas".into())
            })?;
            if let Some(nodes) = object.get("nodes") {
                if !nodes.is_array() {
                    return Err(AppError::Usage("\"nodes\" tiene que ser una lista".into()));
                }
            }
            if let Some(edges) = object.get("edges") {
                if !edges.is_array() {
                    return Err(AppError::Usage("\"edges\" tiene que ser una lista".into()));
                }
            }
            if length > 600_000 {
                return Err(AppError::Usage("el canvas supera 600 KB".into()));
            }
        }
        NoteKind::Note => {
            if length > 250_000 {
                return Err(AppError::Usage("la nota supera 250 KB".into()));
            }
        }
    }
    Ok(())
}

/// Título para una nota nueva: el primer `# encabezado` o el nombre del archivo.
pub fn title_from_markdown(markdown: &str, fallback: &str) -> String {
    for line in markdown.lines() {
        if let Some(heading) = line.strip_prefix("# ") {
            let heading = heading.trim();
            if !heading.is_empty() {
                return heading.to_string();
            }
        }
    }
    fallback.to_string()
}

pub struct FirestoreBackend {
    store: RestStore,
}

impl FirestoreBackend {
    /// Abre el store con la identidad del agente (renueva el token si hace falta).
    pub fn open() -> Result<Self> {
        let (token, creds) = auth::id_token(false)?;
        let project = std::env::var("FIREMD_PROJECT")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| Some(creds.project_id.clone()).filter(|value| !value.is_empty()))
            .unwrap_or_else(|| auth::DEFAULT_PROJECT.to_string());
        if creds.uid.is_empty() {
            return Err(AppError::Usage(
                "no se pudo determinar la identidad del agente".into(),
            ));
        }
        Ok(Self {
            store: RestStore::new(&project, &token, &creds.uid)?,
        })
    }

    pub fn from_store(store: RestStore) -> Self {
        Self { store }
    }
}

fn document_to_folder(doc: &Document) -> Folder {
    let mut acl = BTreeMap::new();
    for key in ["memberIds", "roles", "access"] {
        if let Some(value) = doc.fields.get(key) {
            acl.insert(key.to_string(), value.clone());
        }
    }
    Folder {
        id: doc.name.rsplit('/').next().unwrap_or_default().to_string(),
        name: doc.string("name"),
        parent_id: doc
            .fields
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty()),
        acl,
    }
}

fn document_to_note(doc: &Document) -> NoteMeta {
    NoteMeta {
        id: doc.name.rsplit('/').next().unwrap_or_default().to_string(),
        title: doc.string("title"),
        folder_id: doc
            .fields
            .get("folderId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty()),
        kind: NoteKind::from_stored(&doc.string("kind")),
        version: doc.int("version"),
        update_time: doc.update_time.clone(),
    }
}

impl Backend for FirestoreBackend {
    fn uid(&self) -> &str {
        &self.store.uid
    }

    fn folders(&self) -> Result<Vec<Folder>> {
        let docs = self.store.query(
            &Query::new("folders")
                .member_of(self.uid())
                .select(&["name", "parentId", "memberIds", "roles", "access"])
                .limit(300),
        )?;
        Ok(docs.iter().map(document_to_folder).collect())
    }

    fn notes(&self) -> Result<Vec<NoteMeta>> {
        let docs = self.store.query(
            &Query::new("notes")
                .member_of(self.uid())
                .order_by("updatedAt", "DESCENDING")
                .select(&["title", "updatedAt", "folderId", "version", "kind"])
                .limit(200),
        )?;
        Ok(docs.iter().map(document_to_note).collect())
    }

    fn note(&self, id: &str) -> Result<Option<NoteMeta>> {
        Ok(self.store.get("notes", id)?.as_ref().map(document_to_note))
    }

    fn read_body(&self, note: &NoteMeta) -> Result<NoteBody> {
        if let Some(body) = self.store.get(&format!("notes/{}/body", note.id), "main")? {
            return Ok(NoteBody {
                markdown: body.string("markdown"),
                version: note.version,
            });
        }
        // Notas viejas: el cuerpo todavía vive en el documento de la nota.
        match self.store.get("notes", &note.id)? {
            Some(doc) => Ok(NoteBody {
                markdown: doc.string("markdown"),
                version: note.version,
            }),
            None => Err(AppError::NotFound(format!("la nota {}", note.id))),
        }
    }

    fn replace_body(
        &self,
        note: &NoteMeta,
        markdown: &str,
        expected_etag: Option<&str>,
    ) -> Result<NoteWrite> {
        validate_body(note.kind, markdown)?;

        let current = self.read_body(note)?;
        let actual = etag_of(&current.markdown, note.version);
        if let Some(expected) = expected_etag {
            if expected != actual {
                return Err(AppError::Etag(actual));
            }
        }

        let next_version = note.version + 1;
        let bytes = markdown.chars().count() as i64;
        let tags: Vec<Value> = match note.kind {
            NoteKind::Canvas => Vec::new(),
            NoteKind::Note => extract_tags(markdown).into_iter().map(Value::Str).collect(),
        };

        let writes = vec![
            Write::new(format!("notes/{}/body", note.id), "main")
                .set("markdown", Value::Str(markdown.to_string()))
                .set("bytes", Value::Int(bytes))
                .set("version", Value::Int(next_version))
                .transform("updatedAt", Transform::ServerTimestamp),
            Write::new("notes", &note.id)
                .set("markdownBytes", Value::Int(bytes))
                .set("tags", Value::Array(tags))
                .transform("version", Transform::Increment(1))
                .transform("updatedAt", Transform::ServerTimestamp)
                .update_time(note.update_time.clone()),
        ];
        self.store.commit(&writes)?;

        Ok(NoteWrite {
            id: note.id.clone(),
            etag: etag_of(markdown, next_version),
        })
    }

    fn create_note(
        &self,
        folder: &Folder,
        title: &str,
        body: &str,
        kind: NoteKind,
    ) -> Result<NoteWrite> {
        validate_body(kind, body)?;

        let id = self.store.new_id();
        let bytes = body.chars().count() as i64;
        let mut fields: BTreeMap<String, Value> = BTreeMap::new();
        fields.insert("ownerId".into(), Value::Str(self.uid().to_string()));
        fields.insert("folderId".into(), Value::Str(folder.id.clone()));
        fields.insert("aclSource".into(), Value::Str("folder".into()));
        // La nota espeja el ACL de la carpeta: las reglas lo verifican.
        for key in ["memberIds", "roles", "access"] {
            if let Some(value) = folder.acl.get(key) {
                fields.insert(key.to_string(), value.clone());
            }
        }
        fields.insert(
            "title".into(),
            Value::Str(title.chars().take(300).collect::<String>()),
        );
        if kind == NoteKind::Canvas {
            fields.insert("kind".into(), Value::Str("canvas".into()));
        }
        fields.insert("markdownBytes".into(), Value::Int(bytes));
        fields.insert(
            "tags".into(),
            Value::Array(match kind {
                NoteKind::Canvas => Vec::new(),
                NoteKind::Note => extract_tags(body).into_iter().map(Value::Str).collect(),
            }),
        );
        fields.insert("version".into(), Value::Int(1));

        let writes = vec![
            Write::new("notes", &id)
                .fields(fields)
                .transform("createdAt", Transform::ServerTimestamp)
                .transform("updatedAt", Transform::ServerTimestamp)
                .create_only(),
            Write::new(format!("notes/{id}/body"), "main")
                .set("markdown", Value::Str(body.to_string()))
                .set("bytes", Value::Int(bytes))
                .set("version", Value::Int(1))
                .transform("updatedAt", Transform::ServerTimestamp)
                .create_only(),
        ];
        self.store.commit(&writes)?;

        Ok(NoteWrite {
            id,
            etag: etag_of(body, 1),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_titulo_sale_del_primer_encabezado() {
        assert_eq!(title_from_markdown("# Hola\n\ncuerpo", "archivo"), "Hola");
        assert_eq!(title_from_markdown("sin encabezado", "archivo"), "archivo");
        assert_eq!(title_from_markdown("# \n", "archivo"), "archivo");
    }

    #[test]
    fn un_canvas_tiene_que_ser_json_valido() {
        assert!(validate_body(NoteKind::Canvas, "{}").is_ok());
        assert!(validate_body(NoteKind::Canvas, "{\"nodes\":[]}").is_ok());
        assert!(validate_body(NoteKind::Canvas, "no es json").is_err());
        assert!(validate_body(NoteKind::Canvas, "[]").is_err());
        assert!(validate_body(NoteKind::Canvas, "{\"nodes\":{}}").is_err());
        assert!(validate_body(NoteKind::Note, "texto").is_ok());
    }

    #[test]
    fn una_nota_gigante_se_rechaza() {
        let big = "a".repeat(250_001);
        assert!(validate_body(NoteKind::Note, &big).is_err());
    }
}
