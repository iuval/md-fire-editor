//! Conexión con la cuenta del sitio web.
//!
//! Google no deja hacer su login dentro de un webview embebido (lo rechaza por
//! user-agent), así que la app abre el navegador del sistema en una página del
//! sitio. Esa página ya tiene la sesión de Google; con un botón devuelve el
//! refresh token a un servidor local efímero. Es el mismo patrón de
//! `gh auth login`: loopback + nonce de un solo uso.
//!
//! El servidor escucha sólo en 127.0.0.1, en un puerto al azar, acepta un único
//! handshake con el `state` correcto y se apaga. Nada se escribe en disco hasta
//! que el token se valida contra `securetoken` (ver `auth::save_account_session`).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

/// Dónde vive la app web. Se puede cambiar con `FIREMD_SITE`.
pub const DEFAULT_SITE: &str = "https://firemd.app";
/// Cuánto esperamos a que el usuario termine en el navegador.
pub const TIMEOUT: Duration = Duration::from_secs(180);
const MAX_BODY: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Lo que la página del sitio devuelve. El `uid` que manda la página no se usa
/// como identidad: se toma el `user_id` de la respuesta de `securetoken`, que es
/// el que firma Google.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handshake {
    pub state: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    #[serde(default)]
    pub uid: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

pub struct Listener {
    inner: TcpListener,
    port: u16,
    state: String,
}

impl Listener {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn state(&self) -> &str {
        &self.state
    }

    /// URL que se abre en el navegador: la página del sitio con el puerto y el
    /// nonce en el query string.
    pub fn url(&self) -> String {
        format!("{}/?desktop={}&state={}", site_url(), self.port, self.state)
    }
}

pub fn site_url() -> String {
    std::env::var("FIREMD_SITE")
        .ok()
        .filter(|site| !site.is_empty())
        .unwrap_or_else(|| DEFAULT_SITE.to_string())
}

/// Nonce de un solo uso. `RandomState` se siembra con la entropía del sistema
/// (sin dependencias nuevas), así que alcanza para un CSRF de loopback.
pub fn nonce() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let seed = RandomState::new();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mut high = seed.build_hasher();
    high.write_u64(stamp);
    high.write_u32(std::process::id());
    let mut low = seed.build_hasher();
    low.write_u64(stamp.rotate_left(31));
    low.write_u32(std::process::id());
    format!("{:016x}{:016x}", high.finish(), low.finish())
}

/// Abre el puerto en 127.0.0.1:0 (el sistema elige uno libre).
pub fn listen() -> Result<Listener> {
    let inner = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    inner.set_nonblocking(true)?;
    let port = inner.local_addr()?.port();
    Ok(Listener {
        inner,
        port,
        state: nonce(),
    })
}

/// Abre el navegador del sistema. Best effort: si falla, la UI muestra la URL.
pub fn open_browser(url: &str) -> Result<()> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    } else {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Usage(format!("no pude abrir el navegador: {error}")))
}

/// Espera el handshake. Acepta conexiones hasta que una trae el `state` correcto
/// o se vence el plazo. Un `state` equivocado contesta 400 y no corta la espera.
pub fn wait_for_handshake(listener: &Listener, timeout: Duration) -> Result<Handshake> {
    let deadline = Instant::now() + timeout;
    loop {
        match listener.inner.accept() {
            Ok((stream, _)) => {
                if let Some(handshake) = serve(stream, &listener.state) {
                    return Ok(handshake);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(AppError::Auth(
                        "se venció el plazo: no llegó la confirmación del navegador".into(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// Atiende una conexión. Devuelve `Some` sólo si era el handshake válido.
fn serve(mut stream: TcpStream, expected: &str) -> Option<Handshake> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));

    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(_) => {
            let _ = respond(
                &mut stream,
                "400 Bad Request",
                None,
                "application/json",
                r#"{"error":"pedido inválido"}"#,
            );
            return None;
        }
    };
    let origin = request.header("origin").map(str::to_string);
    let allowed = origin.as_deref().filter(|origin| allowed_origin(origin));

    if request.method == "OPTIONS" {
        let _ = respond_preflight(&mut stream, allowed);
        return None;
    }

    if request.method == "GET" && request.path == "/" {
        let _ = respond(
            &mut stream,
            "200 OK",
            allowed,
            "text/html; charset=utf-8",
            PAGE,
        );
        return None;
    }

    if request.method != "POST" || request.path != "/handshake" {
        let _ = respond(
            &mut stream,
            "404 Not Found",
            allowed,
            "application/json",
            r#"{"error":"ruta desconocida"}"#,
        );
        return None;
    }

    let handshake: Handshake = match serde_json::from_slice(&request.body) {
        Ok(handshake) => handshake,
        Err(_) => {
            let _ = respond(
                &mut stream,
                "400 Bad Request",
                allowed,
                "application/json",
                r#"{"error":"cuerpo inválido"}"#,
            );
            return None;
        }
    };

    if handshake.state != expected {
        let _ = respond(
            &mut stream,
            "400 Bad Request",
            allowed,
            "application/json",
            r#"{"error":"state inválido"}"#,
        );
        return None;
    }

    if handshake.refresh_token.trim().is_empty() {
        let _ = respond(
            &mut stream,
            "400 Bad Request",
            allowed,
            "application/json",
            r#"{"error":"falta el token"}"#,
        );
        return None;
    }

    let _ = respond(
        &mut stream,
        "200 OK",
        allowed,
        "application/json",
        r#"{"ok":true}"#,
    );
    Some(handshake)
}

/// Orígenes que pueden mandar el handshake: el sitio y los puertos de desarrollo.
/// El nonce es el guardia real; esto sólo evita que una página cualquiera intente
/// leer la respuesta.
pub fn allowed_origin(origin: &str) -> bool {
    const SITES: [&str; 4] = [
        "https://firemd.app",
        "https://www.firemd.app",
        "https://md-sync-app.web.app",
        "https://md-sync-app.firebaseapp.com",
    ];
    SITES.contains(&origin)
        || origin.starts_with("http://localhost:")
        || origin.starts_with("http://127.0.0.1:")
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Request> {
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    if method.is_empty() || path.is_empty() {
        return Err(AppError::Usage("pedido HTTP vacío".into()));
    }

    let mut headers = Vec::new();
    let mut length = 0usize;
    loop {
        let mut raw = String::new();
        if reader.read_line(&mut raw)? == 0 {
            break;
        }
        let trimmed = raw.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim().to_string();
            if key == "content-length" {
                length = value.parse().unwrap_or(0);
            }
            headers.push((key, value));
        }
    }

    let mut body = vec![0u8; length.min(MAX_BODY)];
    if !body.is_empty() {
        reader.read_exact(&mut body)?;
    }

    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    origin: Option<&str>,
    content_type: &str,
    body: &str,
) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(origin) = origin {
        head.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\n"));
        head.push_str("Access-Control-Allow-Private-Network: true\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

fn respond_preflight(stream: &mut TcpStream, origin: Option<&str>) -> std::io::Result<()> {
    let mut head = String::from(
        // `Allow-Private-Network` es lo que pide Chrome para dejar que una página
        // https hable con 127.0.0.1 (Private Network Access).
        "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n",
    );
    if let Some(origin) = origin {
        head.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.flush()
}

/// Página que se ve si el usuario entra al puerto a mano.
const PAGE: &str = r#"<!doctype html><html lang="es"><meta charset="utf-8"><title>FireMD Sync</title>
<body style="font:15px/1.5 system-ui,sans-serif;padding:32px;max-width:34rem">
<h1 style="font-size:1.1rem">FireMD Sync</h1>
<p>Este puerto conecta la app de escritorio con tu cuenta. Volvé a la app: si ya
autorizaste el acceso, está lista.</p>
<p style="color:#666">Si no autorizaste nada, podés cerrar esta pestaña.</p>
</body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream as Client;

    /// Manda un pedido HTTP crudo y devuelve la respuesta completa.
    fn request(port: u16, raw: &str) -> String {
        let mut client = Client::connect((Ipv4Addr::LOCALHOST, port)).expect("conectar");
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client.write_all(raw.as_bytes()).unwrap();
        client.flush().unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        response
    }

    fn post(port: u16, state: &str, origin: &str) -> String {
        let body = format!(r#"{{"state":"{state}","refreshToken":"rt","email":"a@b.c"}}"#);
        request(
            port,
            &format!(
                "POST /handshake HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        )
    }

    /// El nonce no se repite entre intentos.
    #[test]
    fn el_nonce_es_impredecible_y_distinto() {
        let first = nonce();
        let second = nonce();
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn la_url_lleva_puerto_y_state() {
        let listener = listen().unwrap();
        let url = listener.url();
        assert!(url.contains(&format!("desktop={}", listener.port())));
        assert!(url.contains(&format!("state={}", listener.state())));
    }

    #[test]
    fn el_handshake_bueno_termina_la_espera() {
        let listener = listen().unwrap();
        let port = listener.port();
        let state = listener.state().to_string();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            post(port, &state, "https://md-sync-app.web.app")
        });
        let handshake = wait_for_handshake(&listener, Duration::from_secs(5)).unwrap();
        let response = worker.join().unwrap();
        assert_eq!(handshake.refresh_token, "rt");
        assert_eq!(handshake.email.as_deref(), Some("a@b.c"));
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains("Access-Control-Allow-Origin: https://md-sync-app.web.app"));
        assert!(response.contains(r#"{"ok":true}"#));
    }

    #[test]
    fn un_state_equivocado_no_termina_la_espera() {
        let listener = listen().unwrap();
        let port = listener.port();
        let state = listener.state().to_string();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            let wrong = post(port, "no-es-el-state", "https://md-sync-app.web.app");
            std::thread::sleep(Duration::from_millis(80));
            let good = post(port, &state, "https://md-sync-app.web.app");
            (wrong, good)
        });
        let handshake = wait_for_handshake(&listener, Duration::from_secs(5)).unwrap();
        let (wrong, good) = worker.join().unwrap();
        assert_eq!(handshake.refresh_token, "rt");
        assert!(wrong.starts_with("HTTP/1.1 400"), "{wrong}");
        assert!(good.starts_with("HTTP/1.1 200"), "{good}");
    }

    /// Levanta el servidor en un hilo con un plazo corto y devuelve el puerto.
    /// El hilo termina solo (por plazo) y su resultado se ignora.
    fn serve_in_background() -> (u16, std::thread::JoinHandle<Result<Handshake>>) {
        let listener = listen().unwrap();
        let port = listener.port();
        let handle =
            std::thread::spawn(move || wait_for_handshake(&listener, Duration::from_millis(800)));
        (port, handle)
    }

    #[test]
    fn el_preflight_contesta_204_con_cors() {
        let (port, server) = serve_in_background();
        let response = request(
            port,
            "OPTIONS /handshake HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://md-sync-app.web.app\r\nAccess-Control-Request-Method: POST\r\n\r\n",
        );
        assert!(response.starts_with("HTTP/1.1 204"), "{response}");
        assert!(response.contains("Access-Control-Allow-Methods: POST, OPTIONS"));
        assert!(response.contains("Access-Control-Allow-Private-Network: true"));
        assert!(response.contains("Access-Control-Allow-Origin: https://md-sync-app.web.app"));
        let _ = server.join();
    }

    #[test]
    fn un_origen_desconocido_no_recibe_cors() {
        let (port, server) = serve_in_background();
        let response = post(port, "x", "https://evil.example");
        assert!(response.starts_with("HTTP/1.1 400"), "{response}");
        assert!(!response.contains("Access-Control-Allow-Origin"));
        let _ = server.join();
    }

    #[test]
    fn los_origenes_permitidos_son_el_sitio_y_localhost() {
        assert!(allowed_origin("https://firemd.app"));
        assert!(allowed_origin("https://www.firemd.app"));
        assert!(allowed_origin("https://md-sync-app.web.app"));
        assert!(allowed_origin("https://md-sync-app.firebaseapp.com"));
        assert!(allowed_origin("http://localhost:5173"));
        assert!(allowed_origin("http://127.0.0.1:5173"));
        assert!(!allowed_origin("https://evil.example"));
        assert!(!allowed_origin("http://localhost.evil.example"));
    }

    #[test]
    fn el_plazo_vencido_es_un_error() {
        let listener = listen().unwrap();
        let error = wait_for_handshake(&listener, Duration::from_millis(120)).unwrap_err();
        assert!(error.to_string().contains("se venció el plazo"), "{error}");
    }
}
