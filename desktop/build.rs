//! La clave web de Firebase es pública (viaja en el bundle de la web y en
//! `/__/firebase/init.json`), pero no se versiona: un literal en el repo dispara
//! alertas de secret scanning en cada clon. Se inyecta al compilar, en este orden:
//!
//! 1. `FIREMD_API_KEY` del entorno (CI, o `cargo build` con la variable puesta).
//! 2. `VITE_FIREBASE_API_KEY` del `.env` de la raíz (gitignored; ya existe para
//!    la app web, así que un build local funciona sin configurar nada).
//! 3. Vacío: la app arranca, pero `auth::api_key()` falla con un mensaje claro.
use std::path::Path;

fn main() {
    let key = std::env::var("FIREMD_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .or_else(repo_env_key)
        .unwrap_or_default();
    println!("cargo:rustc-env=FIREMD_DEFAULT_API_KEY={key}");
    println!("cargo:rerun-if-env-changed=FIREMD_API_KEY");
    println!("cargo:rerun-if-changed=../.env");

    tauri_build::build()
}

/// `VITE_FIREBASE_API_KEY=...` del `.env` de la raíz del repo.
fn repo_env_key() -> Option<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    let env = std::fs::read_to_string(path).ok()?;
    env.lines()
        .find_map(|line| line.trim().strip_prefix("VITE_FIREBASE_API_KEY="))
        .map(|value| value.trim().trim_matches(['"', '\'']).to_string())
        .filter(|key| !key.is_empty())
}
