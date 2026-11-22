//! Extracción de tags: espejo de `extractTags` en `agent/core.mjs` (que a su vez
//! espeja `src/lib/tags.ts`). La app web filtra por el campo denormalizado
//! `tags`, así que el escritorio tiene que mantenerlo igual al subir cambios.
//!
//! Los casos de los tests salen de correr la implementación JS: si cambia uno,
//! los tags de la nube y los del escritorio se desincronizan.

const MAX_TAGS: usize = 30;
const MAX_TAG_LENGTH: usize = 50;

/// Caracteres que pueden preceder a un `#` (clase `[\s([{,;:'"]` del original).
const TAG_PREFIX: &str = "([{,;:'\")";

pub fn extract_tags(markdown: &str) -> Vec<String> {
    if markdown.is_empty() {
        return Vec::new();
    }
    let mut found: Vec<String> = Vec::new();

    if let Some(rest) = markdown.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let block = &rest[..end];
            for tag in frontmatter_tags(block) {
                add_unique(&mut found, tag);
            }
        }
    }

    for tag in inline_tags(&strip_code(markdown)) {
        add_unique(&mut found, tag);
    }

    found.sort();
    found.truncate(MAX_TAGS);
    found
}

fn add_unique(found: &mut Vec<String>, tag: String) {
    if !found.contains(&tag) {
        found.push(tag);
    }
}

/// `#tag` en el cuerpo. El `#` tiene que estar al principio del texto o después
/// de un separador: así `https://x/#ancla` no se toma como tag.
fn inline_tags(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut tags = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' {
            let previous_ok =
                i == 0 || chars[i - 1].is_whitespace() || TAG_PREFIX.contains(chars[i - 1]);
            if previous_ok {
                let mut j = i + 1;
                while j < chars.len() && is_tag_char(chars[j]) {
                    j += 1;
                }
                if j > i + 1 {
                    let raw: String = chars[i + 1..j].iter().collect();
                    if let Some(tag) = normalize_tag(&raw) {
                        tags.push(tag);
                    }
                    i = j;
                    continue;
                }
            }
        }
        i += 1;
    }
    tags
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '/' || c == '-'
}

fn normalize_tag(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let without_hash = trimmed.trim_start_matches('#');
    let lowered = without_hash.to_lowercase();
    let mut clean: String = lowered
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '/' | '-'))
        .collect();
    while clean.contains("//") {
        clean = clean.replace("//", "/");
    }
    let clean = clean.trim_matches('/').to_string();
    if clean.is_empty() || clean.chars().count() > MAX_TAG_LENGTH {
        return None;
    }
    // Obsidian exige al menos una letra: `#123` no es un tag.
    if !clean.chars().any(char::is_alphabetic) {
        return None;
    }
    Some(clean)
}

/// Reemplaza bloques de código (vallas ``` / ~~~ y `código` en línea) por
/// espacio: un `#` dentro de un snippet no es un tag.
fn strip_code(markdown: &str) -> String {
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        if let Some((fence, count)) = fence_open(lines[i]) {
            let mut j = i + 1;
            let mut closed = false;
            while j < lines.len() {
                if fence_close(lines[j], fence, count) {
                    closed = true;
                    break;
                }
                j += 1;
            }
            if closed {
                out.push(String::new());
                i = j + 1;
                continue;
            }
        }
        out.push(strip_inline_code(lines[i]));
        i += 1;
    }
    out.join("\n")
}

fn fence_open(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start_matches([' ', '\t']);
    let fence = trimmed.chars().next()?;
    if fence != '`' && fence != '~' {
        return None;
    }
    let count = trimmed.chars().take_while(|c| *c == fence).count();
    if count >= 3 {
        Some((fence, count))
    } else {
        None
    }
}

fn fence_close(line: &str, fence: char, count: usize) -> bool {
    let trimmed = line.trim_start_matches([' ', '\t']);
    trimmed.chars().take_while(|c| *c == fence).count() >= count
}

fn strip_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '`' {
            if let Some(offset) = chars[i + 1..].iter().position(|c| *c == '`') {
                i += offset + 2;
                out.push(' ');
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn frontmatter_tags(block: &str) -> Vec<String> {
    let lines: Vec<&str> = block.split('\n').collect();

    // `tags: [uno, dos]`
    for line in &lines {
        if let Some(rest) = tag_key_rest(line) {
            let value = rest.trim();
            if value.starts_with('[') && value.ends_with(']') {
                return value[1..value.len() - 1]
                    .split(',')
                    .filter_map(normalize_tag)
                    .collect();
            }
        }
    }

    // `tags:` seguido de una lista con guiones
    for (index, line) in lines.iter().enumerate() {
        if let Some(rest) = tag_key_rest(line) {
            if rest.trim().is_empty() {
                let mut items = Vec::new();
                for item in lines.iter().skip(index + 1) {
                    let trimmed = item.trim_start_matches([' ', '\t']);
                    match trimmed.strip_prefix('-') {
                        Some(value) => items.extend(normalize_tag(value)),
                        None => break,
                    }
                }
                if !items.is_empty() {
                    return items;
                }
            }
        }
    }

    // `tag: uno, dos`
    for line in &lines {
        if let Some(rest) = line.strip_prefix("tag:") {
            let value = rest.trim().trim_matches(['"', '\'']);
            if value.is_empty() {
                continue;
            }
            return value
                .split([',', ' ', '\t'])
                .filter(|part| !part.is_empty())
                .filter_map(normalize_tag)
                .collect();
        }
    }

    Vec::new()
}

/// Devuelve lo que sigue a `tag:`/`tags:` si la línea empieza con esa clave.
fn tag_key_rest(line: &str) -> Option<&str> {
    line.strip_prefix("tags:")
        .or_else(|| line.strip_prefix("tag:"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Valores generados con `extractTags` de `agent/core.mjs`.
    #[test]
    fn coincide_con_la_implementacion_js() {
        let cases: Vec<(&str, Vec<&str>)> = vec![
            ("Hola #mundo y #dos/veces, fin.", vec!["dos/veces", "mundo"]),
            (
                "---\ntitle: X\ntags: [Uno, dos/3]\n---\n\n#cuerpo",
                vec!["cuerpo", "dos/3", "uno"],
            ),
            (
                "---\ntags:\n  - alfa\n  - beta/gamma\n---\ntexto",
                vec!["alfa", "beta/gamma"],
            ),
            ("---\ntag: uno, dos\n---\ntexto", vec!["dos", "uno"]),
            ("texto\n\n```js\n// #noesuntag\n```\n\n#real", vec!["real"]),
            ("usa `#noesuntag` y #real", vec!["real"]),
            ("#123 y #4567", vec![]),
            ("#Hola #MUNDO", vec!["hola", "mundo"]),
            ("[x](https://ej.com/#ancla) #real", vec!["real"]),
            ("#a//b #c/", vec!["a/b", "c"]),
            ("#12/34", vec![]),
            ("", vec![]),
            ("fin #ultimo", vec!["ultimo"]),
            (
                "(#parentesis) [#corchete] {#llave} ;#punto,#coma",
                vec!["coma", "corchete", "llave", "parentesis", "punto"],
            ),
            ("#inicio\nlinea", vec!["inicio"]),
            ("---\ntags: [solo]\n---\n", vec!["solo"]),
            ("#canción #año", vec!["año", "canción"]),
            ("~~~\n#nope\n~~~\n#si", vec!["si"]),
            ("```\n#nope", vec!["nope"]),
        ];
        for (markdown, expected) in cases {
            assert_eq!(
                extract_tags(markdown),
                expected,
                "no coincidió con {markdown:?}"
            );
        }
    }

    #[test]
    fn un_tag_larguisimo_se_descarta() {
        let markdown = format!("#{}", "a".repeat(60));
        assert!(extract_tags(&markdown).is_empty());
    }

    #[test]
    fn no_se_repiten() {
        assert_eq!(extract_tags("#uno #uno #UNO"), vec!["uno"]);
    }
}
