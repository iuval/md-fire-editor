//! Un solo tipo de error para todo el motor: los mensajes se muestran tal cual
//! en la UI, así que están en español y son accionables.

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("auth: {0}")]
    Auth(String),
    #[error("firestore: {0}")]
    Firestore(String),
    /// El etag local no coincide con el remoto: nunca se pisa la nube a ciegas.
    #[error("etag desactualizado (actual {0})")]
    Etag(String),
    #[error("no encontré {0}")]
    NotFound(String),
    #[error("no estás logueado: entrá con tu cuenta o generá un código de agente")]
    NotLoggedIn,
    #[error("{0}")]
    Usage(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl AppError {
    /// Código estable para que la UI distinga conflictos de fallos reales.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Etag(_) => "E_ETAG",
            AppError::NotLoggedIn => "E_AUTH",
            AppError::NotFound(_) => "E_NOT_FOUND",
            AppError::Usage(_) => "E_USAGE",
            _ => "E_OTHER",
        }
    }

    pub fn is_etag(&self) -> bool {
        matches!(self, AppError::Etag(_))
    }
}

/// Error serializable para cruzar el puente de Tauri.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
