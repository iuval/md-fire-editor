//! Motor de sincronización de dos vías sobre una carpeta local.
//!
//! Reglas de oro, heredadas de `agent/vault.mjs`:
//!   - la nube manda: cada push lleva el etag que tenía el archivo al bajarlo,
//!     así un archivo viejo nunca pisa una edición remota;
//!   - si el push choca, el trabajo local se guarda en un `.conflicto-…` al lado
//!     del original en vez de perderse;
//!   - el pull no toca archivos con cambios locales sin subir.
//!
//! La diferencia con el CLI es el orden: acá un ciclo hace pull y después push,
//! para que la app pueda sincronizar sola cada pocos segundos.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::backend::{title_from_markdown, Backend};
use crate::error::Result;
use crate::model::{etag_of, NoteKind};
use crate::vault::{
    conflict_path, content_hash, file_mtime_ms, from_slash, is_conflict_copy, list_markdown,
    read_manifest, safe_name, stamp_now, write_manifest, Manifest, ManifestEntry,
};

#[derive(Debug, Clone, Default, Serialize)]
pub struct PullReport {
    pub written: usize,
    pub skipped_local: usize,
    pub folders: usize,
    pub dir: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Conflict {
    pub file: String,
    pub conflict: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PushReport {
    pub updated: usize,
    pub created: Vec<String>,
    pub unchanged: usize,
    pub conflicts: Vec<Conflict>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SyncReport {
    pub pull: PullReport,
    pub push: PushReport,
    pub finished_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Nube → disco. No toca archivos con cambios locales sin subir.
pub fn pull(backend: &dyn Backend, dir: &Path, prune: bool) -> Result<PullReport> {
    fs::create_dir_all(dir)?;

    let folders = backend.folders()?;
    let folder_paths: BTreeMap<String, String> = folders
        .iter()
        .map(|folder| (folder.id.clone(), folder.path(&folders)))
        .collect();

    let mut notes = backend.notes()?;
    // Orden estable: si dos notas comparten nombre, el mismo gana siempre.
    notes.sort_by(|left, right| left.id.cmp(&right.id));

    let manifest = read_manifest(dir);
    let mut next = Manifest::default();
    let mut claimed: BTreeSet<String> = BTreeSet::new();
    let mut report = PullReport {
        dir: dir.display().to_string(),
        folders: folders.len(),
        ..Default::default()
    };

    for note in &notes {
        let folder_path = note
            .folder_id
            .as_ref()
            .and_then(|id| folder_paths.get(id))
            .map(|path| path.trim_matches('/').to_string())
            .unwrap_or_default();
        let title = safe_name(note.title.trim(), "sin-titulo");
        let file = format!("{title}{}", note.kind.extension());
        let path = if folder_path.is_empty() {
            file
        } else {
            format!("{folder_path}/{file}")
        };

        if !claimed.insert(path.clone()) {
            report.warnings.push(format!(
                "{path}: hay otra nota con el mismo nombre; esta quedó sin archivo"
            ));
            continue;
        }

        let full = dir.join(from_slash(&path));
        let previous = manifest.get(&path).cloned();

        if let Some(entry) = &previous {
            if let Ok(local) = fs::read_to_string(&full) {
                let changed = match &entry.sha {
                    Some(sha) => *sha != content_hash(&local),
                    None => file_mtime_ms(&full).unwrap_or(0.0) > entry.mtime.unwrap_or(0.0) + 1.0,
                };
                if changed {
                    // Hay trabajo local sin subir: el push se encarga.
                    report.skipped_local += 1;
                    next.insert(&path, entry.clone());
                    continue;
                }
            }
        }

        let body = backend.read_body(note)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full, &body.markdown)?;
        let mtime = file_mtime_ms(&full);
        let entry = ManifestEntry::new(
            note.id.clone(),
            Some(etag_of(&body.markdown, body.version)),
            &path,
            mtime,
        )
        .with_sha(Some(content_hash(&body.markdown)));
        next.insert(&path, entry);
        report.written += 1;
    }

    // Entradas de notas que no aparecieron en el listado (por ejemplo, de otra
    // sesión): se conservan salvo que se pida limpiar.
    for (path, entry) in &manifest.files {
        if next.files.contains_key(path) || claimed.contains(path) || prune {
            continue;
        }
        next.insert(path, entry.clone());
    }

    write_manifest(dir, &next)?;
    Ok(report)
}

/// Disco → nube. Sólo sube archivos que el agente ya puede ver.
pub fn push(backend: &dyn Backend, dir: &Path) -> Result<PushReport> {
    let folders = backend.folders()?;
    let mut manifest = read_manifest(dir);
    let mut report = PushReport::default();

    for path in list_markdown(dir)? {
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        if is_conflict_copy(&name) {
            // Una copia de conflicto espera decisión humana: no se sube sola.
            report.skipped.push(path);
            continue;
        }

        let full = dir.join(from_slash(&path));
        let content = match fs::read_to_string(&full) {
            Ok(content) => content,
            Err(error) => {
                report.errors.push(format!("{path}: {error}"));
                continue;
            }
        };
        let kind = if name.to_lowercase().ends_with(".canvas") {
            NoteKind::Canvas
        } else {
            NoteKind::Note
        };
        let mtime = file_mtime_ms(&full);

        match manifest.get(&path).cloned() {
            None => {
                let segments: Vec<&str> = path.split('/').collect();
                if segments.len() < 2 {
                    report.errors.push(format!(
                        "{path}: creá la nota desde la app (el agente no puede crear notas sueltas)"
                    ));
                    continue;
                }
                // El camino relativo completo, no sólo el primer segmento: si no,
                // una nota nueva en `Proyectos/Novela/` podría caer en `Proyectos`.
                let folder_path = segments[..segments.len() - 1].join("/");
                let Some(folder) = folders
                    .iter()
                    .find(|folder| folder.path(&folders) == folder_path)
                    .or_else(|| folders.iter().find(|folder| folder.name == folder_path))
                else {
                    report
                        .errors
                        .push(format!("{path}: no encontré la carpeta «{folder_path}»"));
                    continue;
                };
                let stem = name
                    .rsplit_once('.')
                    .map(|(stem, _)| stem)
                    .unwrap_or(&name)
                    .to_string();
                let title = match kind {
                    NoteKind::Canvas => stem,
                    NoteKind::Note => title_from_markdown(&content, &stem),
                };
                match backend.create_note(folder, &title, &content, kind) {
                    Ok(written) => {
                        let entry =
                            ManifestEntry::new(written.id, Some(written.etag), &path, mtime)
                                .with_sha(Some(content_hash(&content)));
                        manifest.insert(&path, entry);
                        report.created.push(path);
                    }
                    Err(error) => report.errors.push(format!("{path}: {error}")),
                }
            }
            Some(entry) => {
                let unchanged = match &entry.sha {
                    Some(sha) => *sha == content_hash(&content),
                    None => mtime.unwrap_or(0.0) <= entry.mtime.unwrap_or(0.0),
                };
                if unchanged {
                    report.unchanged += 1;
                    continue;
                }

                let note = match backend.note(&entry.id)? {
                    Some(note) => note,
                    None => {
                        report
                            .errors
                            .push(format!("{path}: la nota ya no existe en la nube"));
                        continue;
                    }
                };
                match backend.replace_body(&note, &content, entry.etag.as_deref()) {
                    Ok(written) => {
                        let next = ManifestEntry::new(written.id, Some(written.etag), &path, mtime)
                            .with_sha(Some(content_hash(&content)));
                        manifest.insert(&path, next);
                        report.updated += 1;
                    }
                    Err(error) if error.is_etag() => {
                        // Nunca se descarta el trabajo local en silencio: se guarda
                        // al lado y el original vuelve a la versión de la nube, así
                        // el próximo ciclo no vuelve a chocar.
                        let conflict = conflict_path(&path, &stamp_now());
                        fs::write(dir.join(from_slash(&conflict)), &content)?;
                        if let Ok(Some(fresh)) = backend.note(&entry.id) {
                            if let Ok(remote) = backend.read_body(&fresh) {
                                fs::write(&full, &remote.markdown)?;
                                manifest.insert(
                                    &path,
                                    ManifestEntry::new(
                                        fresh.id.clone(),
                                        Some(etag_of(&remote.markdown, remote.version)),
                                        &path,
                                        file_mtime_ms(&full),
                                    )
                                    .with_sha(Some(content_hash(&remote.markdown))),
                                );
                            }
                        }
                        report.conflicts.push(Conflict {
                            file: path.clone(),
                            conflict,
                        });
                    }
                    Err(error) => report.errors.push(format!("{path}: {error}")),
                }
            }
        }
    }

    write_manifest(dir, &manifest)?;
    Ok(report)
}

/// Un ciclo completo: bajar cambios, subir los locales.
pub fn cycle(backend: &dyn Backend, dir: &Path) -> Result<SyncReport> {
    let pull_report = pull(backend, dir, false)?;
    let push_report = push(backend, dir)?;
    Ok(SyncReport {
        pull: pull_report,
        push: push_report,
        finished_at: now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::firestore::Value;
    use crate::model::{Folder, NoteMeta};
    use std::cell::RefCell;
    use std::path::PathBuf;

    struct FakeBackend {
        uid: String,
        folders: Vec<Folder>,
        notes: RefCell<BTreeMap<String, (NoteMeta, String)>>,
        next_id: RefCell<usize>,
        /// (folder_id, título, kind) de cada nota creada por el push.
        created: RefCell<Vec<(String, String, String)>>,
    }

    impl FakeBackend {
        fn new() -> Self {
            Self {
                uid: "agente".into(),
                folders: Vec::new(),
                notes: RefCell::new(BTreeMap::new()),
                next_id: RefCell::new(1),
                created: RefCell::new(Vec::new()),
            }
        }

        fn add_folder(&mut self, id: &str, name: &str, parent_id: Option<&str>) {
            let mut acl = BTreeMap::new();
            acl.insert(
                "memberIds".to_string(),
                Value::Array(vec![Value::Str("agente".into())]),
            );
            self.folders.push(Folder {
                id: id.into(),
                name: name.into(),
                parent_id: parent_id.map(str::to_string),
                acl,
            });
        }

        fn add_note(&mut self, folder_id: Option<&str>, title: &str, body: &str) -> String {
            let id = format!("note{:02}", self.next_id.borrow());
            *self.next_id.borrow_mut() += 1;
            self.notes.borrow_mut().insert(
                id.clone(),
                (
                    NoteMeta {
                        id: id.clone(),
                        title: title.into(),
                        folder_id: folder_id.map(str::to_string),
                        kind: NoteKind::Note,
                        version: 1,
                        update_time: Some("2026-01-01T00:00:00Z".into()),
                    },
                    body.into(),
                ),
            );
            id
        }

        fn body(&self, id: &str) -> String {
            self.notes.borrow().get(id).unwrap().1.clone()
        }

        /// Simula que alguien editó la nota en la web.
        fn edit_remotely(&self, id: &str, body: &str) {
            let mut notes = self.notes.borrow_mut();
            let (meta, stored) = notes.get_mut(id).unwrap();
            meta.version += 1;
            *stored = body.to_string();
        }
    }

    impl Backend for FakeBackend {
        fn uid(&self) -> &str {
            &self.uid
        }

        fn folders(&self) -> Result<Vec<Folder>> {
            Ok(self.folders.clone())
        }

        fn notes(&self) -> Result<Vec<NoteMeta>> {
            Ok(self
                .notes
                .borrow()
                .values()
                .map(|(note, _)| note.clone())
                .collect())
        }

        fn note(&self, id: &str) -> Result<Option<NoteMeta>> {
            Ok(self.notes.borrow().get(id).map(|(note, _)| note.clone()))
        }

        fn read_body(&self, note: &NoteMeta) -> Result<crate::model::NoteBody> {
            let notes = self.notes.borrow();
            let (_, body) = notes
                .get(&note.id)
                .ok_or_else(|| AppError::NotFound(format!("la nota {}", note.id)))?;
            Ok(crate::model::NoteBody {
                markdown: body.clone(),
                version: note.version,
            })
        }

        fn replace_body(
            &self,
            note: &NoteMeta,
            markdown: &str,
            expected_etag: Option<&str>,
        ) -> Result<crate::model::NoteWrite> {
            let mut notes = self.notes.borrow_mut();
            let (meta, body) = notes
                .get_mut(&note.id)
                .ok_or_else(|| AppError::NotFound(format!("la nota {}", note.id)))?;
            let actual = etag_of(body, meta.version);
            if let Some(expected) = expected_etag {
                if expected != actual {
                    return Err(AppError::Etag(actual));
                }
            }
            meta.version += 1;
            *body = markdown.to_string();
            Ok(crate::model::NoteWrite {
                id: note.id.clone(),
                etag: etag_of(markdown, meta.version),
            })
        }

        fn create_note(
            &self,
            folder: &Folder,
            title: &str,
            body: &str,
            kind: NoteKind,
        ) -> Result<crate::model::NoteWrite> {
            let id = format!("note{:02}", self.next_id.borrow());
            *self.next_id.borrow_mut() += 1;
            self.notes.borrow_mut().insert(
                id.clone(),
                (
                    NoteMeta {
                        id: id.clone(),
                        title: title.into(),
                        folder_id: Some(folder.id.clone()),
                        kind,
                        version: 1,
                        update_time: Some("2026-01-01T00:00:00Z".into()),
                    },
                    body.into(),
                ),
            );
            self.created.borrow_mut().push((
                folder.id.clone(),
                title.to_string(),
                kind.as_str().to_string(),
            ));
            Ok(crate::model::NoteWrite {
                id,
                etag: etag_of(body, 1),
            })
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "firemd-sync-{}-{}-{}",
            std::process::id(),
            tag,
            now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn pull_escribe_los_archivos_y_el_manifiesto() {
        let dir = temp_dir("pull");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        let id = backend.add_note(Some("f1"), "Ideas", "# Ideas\n\n- uno #producto\n");

        let report = pull(&backend, &dir, false).unwrap();

        assert_eq!(report.written, 1);
        assert_eq!(report.folders, 1);
        assert_eq!(
            read(&dir.join("Trabajo/Ideas.md")),
            "# Ideas\n\n- uno #producto\n"
        );

        let manifest = read_manifest(&dir);
        let entry = manifest.get("Trabajo/Ideas.md").unwrap();
        assert_eq!(entry.id, id);
        assert_eq!(entry.etag.as_deref(), Some("1-0ed29f4be911"));
        assert!(entry.sha.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pull_no_pisa_cambios_locales() {
        let dir = temp_dir("pull-local");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        backend.add_note(Some("f1"), "Ideas", "remoto\n");

        pull(&backend, &dir, false).unwrap();
        fs::write(dir.join("Trabajo/Ideas.md"), "local\n").unwrap();

        let report = pull(&backend, &dir, false).unwrap();
        assert_eq!(report.written, 0);
        assert_eq!(report.skipped_local, 1);
        assert_eq!(read(&dir.join("Trabajo/Ideas.md")), "local\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_sube_la_edicion_local_y_actualiza_el_etag() {
        let dir = temp_dir("push");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        let id = backend.add_note(Some("f1"), "Ideas", "remoto\n");
        pull(&backend, &dir, false).unwrap();

        fs::write(dir.join("Trabajo/Ideas.md"), "editado\n").unwrap();
        let report = push(&backend, &dir).unwrap();

        assert_eq!(report.updated, 1);
        assert!(report.conflicts.is_empty());
        let manifest = read_manifest(&dir);
        let entry = manifest.get("Trabajo/Ideas.md").unwrap();
        assert_eq!(entry.id, id);
        assert_eq!(entry.sha.as_deref(), Some(&content_hash("editado\n")[..]));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_sin_cambios_no_hace_nada() {
        let dir = temp_dir("push-unchanged");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        backend.add_note(Some("f1"), "Ideas", "igual\n");
        pull(&backend, &dir, false).unwrap();

        let report = push(&backend, &dir).unwrap();
        assert_eq!(report.unchanged, 1);
        assert_eq!(report.updated, 0);
        assert_eq!(report.created.len(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_con_etag_viejo_crea_un_archivo_de_conflicto() {
        let dir = temp_dir("conflict");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        let id = backend.add_note(Some("f1"), "Ideas", "remoto\n");
        pull(&backend, &dir, false).unwrap();

        // Alguien editó en la web después del pull: el etag guardado quedó viejo.
        backend.edit_remotely(&id, "remoto v2\n");

        fs::write(dir.join("Trabajo/Ideas.md"), "local\n").unwrap();
        let report = push(&backend, &dir).unwrap();

        assert_eq!(report.updated, 0);
        assert_eq!(report.conflicts.len(), 1);
        let conflict = &report.conflicts[0];
        assert!(conflict.conflict.starts_with("Trabajo/Ideas.conflicto-"));
        assert_eq!(read(&dir.join(&conflict.conflict)), "local\n");
        // El original vuelve a la versión de la nube y la nube no se tocó.
        assert_eq!(read(&dir.join("Trabajo/Ideas.md")), "remoto v2\n");
        assert_eq!(backend.body(&id), "remoto v2\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_crea_la_nota_nueva_dentro_de_la_carpeta() {
        let dir = temp_dir("create");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        pull(&backend, &dir, false).unwrap();

        fs::create_dir_all(dir.join("Trabajo")).unwrap();
        fs::write(dir.join("Trabajo/Nueva.md"), "# Título nuevo\n\ncuerpo\n").unwrap();
        let report = push(&backend, &dir).unwrap();

        assert_eq!(report.created, vec!["Trabajo/Nueva.md".to_string()]);
        let manifest = read_manifest(&dir);
        assert_eq!(manifest.get("Trabajo/Nueva.md").unwrap().id, "note01");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_crea_la_nota_en_la_carpeta_anidada_correcta() {
        let dir = temp_dir("nested-create");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Proyectos", None);
        backend.add_folder("f2", "Novela", Some("f1"));
        pull(&backend, &dir, false).unwrap();

        fs::create_dir_all(dir.join("Proyectos/Novela")).unwrap();
        fs::write(dir.join("Proyectos/Novela/Cap 2.md"), "# Cap 2\n").unwrap();
        let report = push(&backend, &dir).unwrap();

        assert_eq!(
            report.created,
            vec!["Proyectos/Novela/Cap 2.md".to_string()]
        );
        let created = backend.created.borrow();
        assert_eq!(
            created[0].0, "f2",
            "tiene que caer en Novela, no en Proyectos"
        );
        assert_eq!(created[0].1, "Cap 2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_no_crea_notas_sueltas_en_la_raiz() {
        let dir = temp_dir("create-root");
        let backend = FakeBackend::new();
        fs::write(dir.join("Suelta.md"), "texto\n").unwrap();

        let report = push(&backend, &dir).unwrap();
        assert!(report.created.is_empty());
        assert_eq!(report.errors.len(), 1);
        assert!(report.errors[0].contains("creá la nota desde la app"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_no_sube_las_copias_de_conflicto() {
        let dir = temp_dir("skip-conflict");
        let backend = FakeBackend::new();
        fs::create_dir_all(dir.join("Trabajo")).unwrap();
        fs::write(
            dir.join("Trabajo/Nota.conflicto-202601151430.md"),
            "local\n",
        )
        .unwrap();

        let report = push(&backend, &dir).unwrap();
        assert!(report.created.is_empty());
        assert_eq!(report.skipped.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_ciclo_baja_y_sube() {
        let dir = temp_dir("cycle");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        backend.add_note(Some("f1"), "Ideas", "remoto\n");

        let report = cycle(&backend, &dir).unwrap();
        assert_eq!(report.pull.written, 1);
        assert_eq!(report.push.unchanged, 1);
        assert!(report.finished_at > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn las_carpetas_anidadas_arman_el_camino() {
        let dir = temp_dir("nested");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Proyectos", None);
        backend.add_folder("f2", "Novela", Some("f1"));
        backend.add_note(Some("f2"), "Cap 1", "texto\n");

        pull(&backend, &dir, false).unwrap();
        assert!(dir.join("Proyectos/Novela/Cap 1.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dos_notas_con_el_mismo_nombre_avisan() {
        let dir = temp_dir("dupe");
        let mut backend = FakeBackend::new();
        backend.add_folder("f1", "Trabajo", None);
        backend.add_note(Some("f1"), "Igual", "uno\n");
        backend.add_note(Some("f1"), "Igual", "dos\n");

        let report = pull(&backend, &dir, false).unwrap();
        assert_eq!(report.written, 1);
        assert_eq!(report.warnings.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
