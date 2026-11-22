//! Identidad del agente: una cuenta anónima de Firebase emparejada desde la app
//! web (Agentes de IA → pegar el uid).
//!
//! El agente es un usuario normal, así que las reglas de Firestore deciden qué
//! puede leer y escribir. Sin Admin SDK, sin claves de servicio, sin bypass.
//!
//! El archivo de credenciales es el mismo que usa el CLI (`agent/auth.mjs`), de
//! modo que un `mdfire login` previo ya sirve para la app de escritorio.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

pub const DEFAULT_PROJECT: &str = "md-sync-app";
pub const DEFAULT_REFERER: &str = "https://md-sync-app.web.app/";
/// La clave web de Firebase es pública (viaja en el bundle) y está restringida
/// por referrer. Se puede cambiar con `MDFIRE_API_KEY` o en los ajustes.
pub const DEFAULT_API_KEY: &str = "AIzaSyAl9EyRLFIni3XliwC_WCc_yRvhIrWX0YQ";

fn default_project() -> String {
    DEFAULT_PROJECT.to_string()
}

fn default_referer() -> String {
    DEFAULT_REFERER.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    #[serde(default)]
    pub uid: String,
    #[serde(rename = "refreshToken", default)]
    pub refresh_token: Option<String>,
    #[serde(rename = "idToken", default)]
    pub id_token: Option<String>,
    /// Milisegundos desde epoch, igual que el CLI.
    #[serde(rename = "expiresAt", default)]
    pub expires_at: u64,
    #[serde(rename = "projectId", default = "default_project")]
    pub project_id: String,
    #[serde(default = "default_referer")]
    pub referer: String,
    #[serde(default)]
    pub revoked: bool,
    /// Correo de la cuenta del sitio, cuando la sesión es una cuenta real (no un
    /// agente anónimo). Sólo se usa para mostrar "Conectada como …".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Campos que no conocemos (los escribe el CLI): se conservan al guardar.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Credentials {
    fn default() -> Self {
        Self {
            uid: String::new(),
            refresh_token: None,
            id_token: None,
            expires_at: 0,
            project_id: default_project(),
            referer: default_referer(),
            revoked: false,
            email: None,
            extra: serde_json::Map::new(),
        }
    }
}

impl Credentials {
    pub fn has_refresh_token(&self) -> bool {
        self.refresh_token.as_deref().is_some_and(|t| !t.is_empty())
    }

    /// Corto y fácil de dictar; el uid completo va en "copiar".
    pub fn pairing_code(&self) -> String {
        self.uid.chars().take(12).collect()
    }

    /// Sesión de una cuenta real del sitio (login con Google), no de un agente.
    pub fn is_account(&self) -> bool {
        self.email.as_deref().is_some_and(|email| !email.is_empty())
    }
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Mismo directorio que el CLI: `$XDG_CONFIG_HOME/mdfire` o `~/.config/mdfire`.
pub fn config_dir() -> PathBuf {
    match std::env::var_os("XDG_CONFIG_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("mdfire"),
        _ => home_dir().join(".config").join("mdfire"),
    }
}

pub fn credentials_path() -> PathBuf {
    config_dir().join("credentials.json")
}

pub fn settings_path() -> PathBuf {
    config_dir().join("desktop.json")
}

pub fn load_credentials() -> Option<Credentials> {
    load_credentials_at(&credentials_path())
}

pub fn load_credentials_at(path: &Path) -> Option<Credentials> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save_credentials(creds: &Credentials) -> Result<()> {
    save_credentials_at(&credentials_path(), creds)
}

pub fn save_credentials_at(path: &Path, creds: &Credentials) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut body = serde_json::to_string_pretty(creds)?;
    body.push('\n');
    fs::write(path, body)?;
    restrict_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

/// Revoca el refresh token (best effort) y deja el archivo sin credenciales.
pub fn logout() -> Result<()> {
    let Some(mut creds) = load_credentials() else {
        return Ok(());
    };
    if let Some(refresh) = creds.refresh_token.clone() {
        let _ = revoke(&refresh);
    }
    creds.refresh_token = None;
    creds.id_token = None;
    creds.revoked = true;
    creds.email = None;
    save_credentials(&creds)
}

pub fn api_key() -> String {
    if let Ok(key) = std::env::var("MDFIRE_API_KEY") {
        if !key.is_empty() {
            return key;
        }
    }
    DEFAULT_API_KEY.to_string()
}

fn auth_base() -> String {
    match std::env::var("FIREBASE_AUTH_EMULATOR_HOST") {
        Ok(host) if !host.is_empty() => format!("http://{host}/identitytoolkit.googleapis.com"),
        _ => "https://identitytoolkit.googleapis.com".to_string(),
    }
}

fn token_base() -> String {
    match std::env::var("FIREBASE_AUTH_EMULATOR_HOST") {
        Ok(host) if !host.is_empty() => format!("http://{host}/securetoken.googleapis.com"),
        _ => "https://securetoken.googleapis.com".to_string(),
    }
}

fn is_emulator() -> bool {
    std::env::var("FIREBASE_AUTH_EMULATOR_HOST").is_ok_and(|h| !h.is_empty())
}

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

fn post_json(url: &str, body: serde_json::Value, referer: &str) -> Result<serde_json::Value> {
    let mut request = client()?
        .post(url)
        .header("Content-Type", "application/json")
        .json(&body);
    // El referrer es la única razón por la que existe la restricción de la clave.
    if !is_emulator() {
        request = request.header("Referer", referer);
    }
    let response = request.send()?;
    let status = response.status();
    let text = response.text().unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let message = parsed
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|message| message.as_str())
            .unwrap_or("error desconocido");
        return Err(AppError::Auth(format!("{message} (HTTP {status})")));
    }
    Ok(parsed)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Crea una cuenta anónima nueva y devuelve las credenciales a persistir.
pub fn login_anonymous(project_id: &str, referer: &str) -> Result<Credentials> {
    let url = format!("{}/v1/accounts:signUp?key={}", auth_base(), api_key());
    let data = post_json(
        &url,
        serde_json::json!({ "returnSecureToken": true }),
        referer,
    )?;

    let uid = data
        .get("localId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Auth("la respuesta no trae localId".into()))?
        .to_string();
    let refresh_token = data
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let id_token = data
        .get("idToken")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let expires_in = data
        .get("expiresIn")
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(3600);

    Ok(Credentials {
        uid,
        refresh_token,
        id_token,
        expires_at: now_ms() + expires_in * 1000,
        project_id: project_id.to_string(),
        referer: referer.to_string(),
        revoked: false,
        email: None,
        extra: serde_json::Map::new(),
    })
}

fn revoke(refresh_token: &str) -> Result<()> {
    let url = format!("{}/v1/token?key={}", token_base(), api_key());
    post_json(
        &url,
        serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }),
        DEFAULT_REFERER,
    )
    .map(|_| ())
}

/// Una sesión ya validada contra `securetoken`.
struct Session {
    id_token: String,
    refresh_token: String,
    expires_in: u64,
    uid: String,
}

/// Cambia un refresh token por un ID token nuevo. Es el único lugar donde se
/// valida un token: si Google lo rechaza, no se guarda nada en disco.
fn refresh_session(refresh_token: &str, referer: &str) -> Result<Session> {
    let url = format!("{}/v1/token?key={}", token_base(), api_key());
    let data = post_json(
        &url,
        serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }),
        referer,
    )?;

    let id_token = data
        .get("id_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Auth("la respuesta no trae id_token".into()))?
        .to_string();
    let refresh_token = data
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    let expires_in = data
        .get("expires_in")
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(3600);
    let uid = data
        .get("user_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(Session {
        id_token,
        refresh_token,
        expires_in,
        uid,
    })
}

/// Guarda la sesión de una cuenta del sitio a partir del refresh token que
/// entrega la página web (`link::Handshake`). El uid sale de Google, no de la
/// página: si el token no es válido, no se escribe nada.
pub fn save_account_session(
    refresh_token: &str,
    email: Option<String>,
    project_id: &str,
    referer: &str,
) -> Result<Credentials> {
    let session = refresh_session(refresh_token, referer)?;
    if session.uid.is_empty() {
        return Err(AppError::Auth(
            "el token no trae user_id: probá de nuevo desde el navegador".into(),
        ));
    }

    let mut creds = load_credentials().unwrap_or_default();
    creds.uid = session.uid;
    creds.refresh_token = Some(session.refresh_token);
    creds.id_token = Some(session.id_token);
    creds.expires_at = now_ms() + session.expires_in * 1000;
    creds.project_id = project_id.to_string();
    creds.referer = referer.to_string();
    creds.revoked = false;
    creds.email = email.filter(|email| !email.is_empty());
    save_credentials(&creds)?;
    Ok(creds)
}

/// Devuelve un ID token válido, refrescándolo si está por vencer.
pub fn id_token(force: bool) -> Result<(String, Credentials)> {
    if let Ok(token) = std::env::var("MDFIRE_ID_TOKEN") {
        if !token.is_empty() {
            let mut creds = load_credentials().unwrap_or_default();
            if creds.uid.is_empty() {
                creds.uid = "token-externo".to_string();
            }
            return Ok((token, creds));
        }
    }

    let mut creds = load_credentials().ok_or(AppError::NotLoggedIn)?;
    if !creds.has_refresh_token() {
        return Err(AppError::NotLoggedIn);
    }
    if !force
        && creds.id_token.as_deref().is_some_and(|t| !t.is_empty())
        && creds.expires_at > now_ms() + 60_000
    {
        return Ok((creds.id_token.clone().unwrap_or_default(), creds));
    }

    let stored = creds.refresh_token.clone().ok_or(AppError::NotLoggedIn)?;
    let session = refresh_session(&stored, &creds.referer)?;

    creds.id_token = Some(session.id_token.clone());
    creds.refresh_token = Some(session.refresh_token);
    creds.expires_at = now_ms() + session.expires_in * 1000;
    creds.revoked = false;
    if !session.uid.is_empty() {
        creds.uid = session.uid;
    }
    save_credentials(&creds)?;
    Ok((session.id_token, creds))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credenciales_sobreviven_el_round_trip_con_campos_extra() {
        let dir = std::env::temp_dir().join(format!("mdfire-auth-test-{}", std::process::id()));
        let path = dir.join("credentials.json");
        let mut creds = Credentials {
            uid: "abc123".into(),
            refresh_token: Some("refresh".into()),
            id_token: Some("id".into()),
            expires_at: 42,
            ..Default::default()
        };
        creds
            .extra
            .insert("algoDelCli".into(), serde_json::json!("se conserva"));

        save_credentials_at(&path, &creds).unwrap();
        let loaded = load_credentials_at(&path).unwrap();
        assert_eq!(loaded.uid, "abc123");
        assert_eq!(loaded.expires_at, 42);
        assert_eq!(
            loaded.extra.get("algoDelCli").and_then(|v| v.as_str()),
            Some("se conserva")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn el_codigo_de_emparejamiento_es_los_primeros_12() {
        let creds = Credentials {
            uid: "abcdefghijklmnop".into(),
            ..Default::default()
        };
        assert_eq!(creds.pairing_code(), "abcdefghijkl");
    }

    #[test]
    fn sin_refresh_token_no_hay_sesion() {
        let creds = Credentials::default();
        assert!(!creds.has_refresh_token());
    }

    #[test]
    fn el_correo_marca_una_cuenta_real_y_sobrevive_el_round_trip() {
        let dir = std::env::temp_dir().join(format!("mdfire-auth-email-{}", std::process::id()));
        let path = dir.join("credentials.json");
        let creds = Credentials {
            uid: "uidDeCuenta".into(),
            refresh_token: Some("refresh".into()),
            email: Some("iuval@example.com".into()),
            ..Default::default()
        };
        assert!(creds.is_account());

        save_credentials_at(&path, &creds).unwrap();
        let loaded = load_credentials_at(&path).unwrap();
        assert_eq!(loaded.email.as_deref(), Some("iuval@example.com"));
        assert!(loaded.is_account());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_agente_anonimo_no_es_una_cuenta() {
        let creds = Credentials {
            uid: "agente".into(),
            refresh_token: Some("refresh".into()),
            ..Default::default()
        };
        assert!(!creds.is_account());
    }

    #[test]
    fn sin_correo_el_archivo_no_escribe_la_clave() {
        let dir = std::env::temp_dir().join(format!("mdfire-auth-nokey-{}", std::process::id()));
        let path = dir.join("credentials.json");
        save_credentials_at(&path, &Credentials::default()).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("email"), "{raw}");
        let _ = fs::remove_dir_all(&dir);
    }
}
