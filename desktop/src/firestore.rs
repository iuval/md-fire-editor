//! Cliente mínimo de Firestore por REST, autenticado con el ID token del agente.
//!
//! Mismo enfoque que `agent/firestore-rest.mjs`: REST en vez del SDK, para que
//! cada lectura y escritura pase por las reglas de seguridad con la identidad
//! del agente. Nada de Admin SDK.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{json, Value as Json};

use crate::error::{AppError, Result};

pub const DEFAULT_PROJECT: &str = "md-sync-app";

// ---------- codec de valores ----------

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Str(String),
    Bool(bool),
    Int(i64),
    Double(f64),
    Timestamp(String),
    Array(Vec<Value>),
    Map(BTreeMap<String, Value>),
}

impl Value {
    pub fn str(value: impl Into<String>) -> Self {
        Value::Str(value.into())
    }

    pub fn to_json(&self) -> Json {
        match self {
            Value::Null => json!({ "nullValue": null }),
            Value::Str(s) => json!({ "stringValue": s }),
            Value::Bool(b) => json!({ "booleanValue": b }),
            Value::Int(i) => json!({ "integerValue": i.to_string() }),
            Value::Double(d) => json!({ "doubleValue": d }),
            Value::Timestamp(t) => json!({ "timestampValue": t }),
            Value::Array(items) => json!({
                "arrayValue": { "values": items.iter().map(Value::to_json).collect::<Vec<_>>() }
            }),
            Value::Map(map) => json!({
                "mapValue": { "fields": fields_to_json(map) }
            }),
        }
    }

    pub fn from_json(value: &Json) -> Option<Value> {
        let object = value.as_object()?;
        if object.contains_key("nullValue") {
            return Some(Value::Null);
        }
        if let Some(s) = object.get("stringValue").and_then(Json::as_str) {
            return Some(Value::Str(s.to_string()));
        }
        if let Some(b) = object.get("booleanValue").and_then(Json::as_bool) {
            return Some(Value::Bool(b));
        }
        if let Some(i) = object.get("integerValue") {
            let parsed = i
                .as_str()
                .and_then(|s| s.parse::<i64>().ok())
                .or_else(|| i.as_i64());
            if let Some(parsed) = parsed {
                return Some(Value::Int(parsed));
            }
        }
        if let Some(d) = object.get("doubleValue").and_then(Json::as_f64) {
            return Some(Value::Double(d));
        }
        if let Some(t) = object.get("timestampValue").and_then(Json::as_str) {
            return Some(Value::Timestamp(t.to_string()));
        }
        if let Some(array) = object.get("arrayValue") {
            let items = array
                .get("values")
                .and_then(Json::as_array)
                .map(|values| values.iter().filter_map(Value::from_json).collect())
                .unwrap_or_default();
            return Some(Value::Array(items));
        }
        if let Some(map) = object.get("mapValue") {
            let fields = map.get("fields").and_then(Json::as_object);
            return Some(Value::Map(fields.map(fields_from_json).unwrap_or_default()));
        }
        None
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) | Value::Timestamp(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            Value::Double(d) => Some(*d as i64),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_map(&self) -> Option<&BTreeMap<String, Value>> {
        match self {
            Value::Map(map) => Some(map),
            _ => None,
        }
    }
}

impl Serialize for Value {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let json = Json::deserialize(deserializer)?;
        Value::from_json(&json).ok_or_else(|| D::Error::custom("valor de Firestore inválido"))
    }
}

pub fn fields_to_json(fields: &BTreeMap<String, Value>) -> Json {
    let mut object = serde_json::Map::new();
    for (key, value) in fields {
        object.insert(key.clone(), value.to_json());
    }
    Json::Object(object)
}

pub fn fields_from_json(fields: &serde_json::Map<String, Json>) -> BTreeMap<String, Value> {
    fields
        .iter()
        .filter_map(|(key, value)| Value::from_json(value).map(|value| (key.clone(), value)))
        .collect()
}

// ---------- documentos ----------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Document {
    #[serde(default)]
    pub name: String,
    #[serde(rename = "updateTime", default)]
    pub update_time: Option<String>,
    #[serde(default)]
    pub fields: BTreeMap<String, Value>,
}

impl Document {
    pub fn id(&self) -> &str {
        self.name.rsplit('/').next().unwrap_or_default()
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.fields.get(key)
    }

    pub fn string(&self, key: &str) -> String {
        self.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    }

    pub fn int(&self, key: &str) -> i64 {
        self.get(key).and_then(Value::as_i64).unwrap_or(0)
    }

    pub fn strings(&self, key: &str) -> Vec<String> {
        self.get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn has(&self, key: &str) -> bool {
        self.fields.contains_key(key)
    }
}

// ---------- consultas ----------

#[derive(Debug, Clone)]
pub struct Query {
    pub collection: String,
    pub filters: Vec<Json>,
    pub order_by: Option<(String, String)>,
    pub fields: Vec<String>,
    pub limit: u32,
}

impl Query {
    pub fn new(collection: impl Into<String>) -> Self {
        Self {
            collection: collection.into(),
            filters: Vec::new(),
            order_by: None,
            fields: Vec::new(),
            limit: 200,
        }
    }

    /// El filtro por `memberIds` es obligatorio: las reglas solo permiten listar
    /// documentos que el llamante puede probar con un `array-contains`.
    pub fn member_of(mut self, uid: &str) -> Self {
        self.filters.push(field_filter(
            "memberIds",
            "ARRAY_CONTAINS",
            json!({ "stringValue": uid }),
        ));
        self
    }

    pub fn order_by(mut self, field: &str, direction: &str) -> Self {
        self.order_by = Some((field.to_string(), direction.to_string()));
        self
    }

    pub fn select(mut self, fields: &[&str]) -> Self {
        self.fields = fields.iter().map(|f| f.to_string()).collect();
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = limit;
        self
    }

    pub fn to_body(&self) -> Json {
        let mut query = json!({
            "from": [{ "collectionId": self.collection }],
            "limit": self.limit,
        });
        if let Some(filter) = self.composite_filter() {
            query["where"] = filter;
        }
        if let Some((field, direction)) = &self.order_by {
            query["orderBy"] = json!([{ "field": { "fieldPath": field }, "direction": direction }]);
        }
        if !self.fields.is_empty() {
            query["select"] = json!({
                "fields": self.fields.iter().map(|f| json!({ "fieldPath": f })).collect::<Vec<_>>()
            });
        }
        query
    }

    fn composite_filter(&self) -> Option<Json> {
        match self.filters.len() {
            0 => None,
            1 => Some(self.filters[0].clone()),
            _ => Some(json!({
                "compositeFilter": { "op": "AND", "filters": self.filters }
            })),
        }
    }
}

pub fn field_filter(field: &str, op: &str, value: Json) -> Json {
    json!({
        "fieldFilter": { "field": { "fieldPath": field }, "op": op, "value": value }
    })
}

// ---------- escrituras ----------

#[derive(Debug, Clone, Copy)]
pub enum Transform {
    ServerTimestamp,
    Increment(i64),
}

impl Transform {
    fn to_json(self, field: &str) -> Json {
        match self {
            Transform::ServerTimestamp => {
                json!({ "fieldPath": field, "setToServerValue": "REQUEST_TIME" })
            }
            Transform::Increment(delta) => json!({
                "fieldPath": field,
                "increment": { "integerValue": delta.to_string() }
            }),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Write {
    pub collection: String,
    pub id: String,
    pub fields: BTreeMap<String, Value>,
    pub transforms: Vec<(String, Transform)>,
    pub update_time: Option<String>,
    pub exists: Option<bool>,
}

impl Write {
    pub fn new(collection: impl Into<String>, id: impl Into<String>) -> Self {
        Self {
            collection: collection.into(),
            id: id.into(),
            ..Default::default()
        }
    }

    pub fn set(mut self, key: &str, value: Value) -> Self {
        self.fields.insert(key.to_string(), value);
        self
    }

    pub fn fields(mut self, fields: BTreeMap<String, Value>) -> Self {
        self.fields = fields;
        self
    }

    pub fn transform(mut self, field: &str, transform: Transform) -> Self {
        self.transforms.push((field.to_string(), transform));
        self
    }

    pub fn update_time(mut self, update_time: Option<String>) -> Self {
        self.update_time = update_time;
        self
    }

    pub fn create_only(mut self) -> Self {
        self.exists = Some(false);
        self
    }
}

// ---------- cliente ----------

pub struct RestStore {
    pub project_id: String,
    pub uid: String,
    pub token: String,
    client: reqwest::blocking::Client,
    base: String,
    prefix: String,
}

impl RestStore {
    pub fn new(project_id: &str, token: &str, uid: &str) -> Result<Self> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(45))
            .build()?;
        let base = match std::env::var("FIRESTORE_EMULATOR_HOST") {
            Ok(host) if !host.is_empty() => format!("http://{host}/v1"),
            _ => "https://firestore.googleapis.com/v1".to_string(),
        };
        Ok(Self {
            project_id: project_id.to_string(),
            uid: uid.to_string(),
            token: token.to_string(),
            client,
            base,
            prefix: format!("projects/{project_id}/databases/(default)/documents"),
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<Json>,
    ) -> Result<Option<Json>> {
        let mut request = self
            .client
            .request(method, url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send()?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let text = response.text().unwrap_or_default();
        let parsed: Json = if text.is_empty() {
            Json::Null
        } else {
            serde_json::from_str(&text).unwrap_or(Json::Null)
        };
        if !status.is_success() {
            let message = parsed
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Json::as_str)
                .unwrap_or("error desconocido");
            let code = parsed
                .get("error")
                .and_then(|error| error.get("status"))
                .and_then(Json::as_str)
                .unwrap_or_default();
            // Un fallo de precondición es un conflicto de edición, no un bug.
            if status == reqwest::StatusCode::BAD_REQUEST || code == "FAILED_PRECONDITION" {
                return Err(AppError::Etag(message.to_string()));
            }
            return Err(AppError::Firestore(format!(
                "{message} (HTTP {status}{})",
                if code.is_empty() {
                    String::new()
                } else {
                    format!(", {code}")
                }
            )));
        }
        Ok(Some(parsed))
    }

    pub fn get(&self, collection_path: &str, id: &str) -> Result<Option<Document>> {
        let url = format!("{}/{}/{collection_path}/{id}", self.base, self.prefix);
        match self.request(reqwest::Method::GET, &url, None)? {
            Some(doc) if doc.get("name").is_some() => Ok(serde_json::from_value(doc).ok()),
            _ => Ok(None),
        }
    }

    pub fn query(&self, query: &Query) -> Result<Vec<Document>> {
        let url = format!("{}/{}:runQuery", self.base, self.prefix);
        let body = json!({ "structuredQuery": query.to_body() });
        let Some(rows) = self.request(reqwest::Method::POST, &url, Some(body))? else {
            return Ok(Vec::new());
        };
        let Some(rows) = rows.as_array() else {
            return Ok(Vec::new());
        };
        Ok(rows
            .iter()
            .filter_map(|row| row.get("document"))
            .filter_map(|doc| serde_json::from_value(doc.clone()).ok())
            .collect())
    }

    pub fn commit(&self, writes: &[Write]) -> Result<()> {
        if writes.is_empty() {
            return Ok(());
        }
        let url = format!("{}/{}:commit", self.base, self.prefix);
        let payload =
            json!({ "writes": writes.iter().map(|w| self.write_json(w)).collect::<Vec<_>>() });
        self.request(reqwest::Method::POST, &url, Some(payload))?;
        Ok(())
    }

    fn write_json(&self, write: &Write) -> Json {
        let mut object = json!({
            "update": {
                "name": format!("{}/{}/{}", self.prefix, write.collection, write.id),
                "fields": fields_to_json(&write.fields),
            },
            "updateMask": { "fieldPaths": write.fields.keys().cloned().collect::<Vec<_>>() },
        });
        if !write.transforms.is_empty() {
            object["updateTransforms"] = Json::Array(
                write
                    .transforms
                    .iter()
                    .map(|(field, transform)| transform.to_json(field))
                    .collect(),
            );
        }
        if let Some(update_time) = &write.update_time {
            object["currentDocument"] = json!({ "updateTime": update_time });
        }
        if write.exists == Some(false) {
            object["currentDocument"] = json!({ "exists": false });
        }
        object
    }

    pub fn remove(&self, collection_path: &str, id: &str) -> Result<()> {
        let url = format!("{}/{}/{collection_path}/{id}", self.base, self.prefix);
        self.request(reqwest::Method::DELETE, &url, None)?;
        Ok(())
    }

    /// Id aleatorio del lado del cliente, como hace el SDK web.
    pub fn new_id(&self) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let mut seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
            ^ (&self.token as *const String as usize as u64);
        (0..20)
            .map(|_| {
                // xorshift64: sin dependencias, suficiente para un id de documento.
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                ALPHABET[(seed % ALPHABET.len() as u64) as usize] as char
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_de_valores_ida_y_vuelta() {
        let mut map = BTreeMap::new();
        map.insert("titulo".to_string(), Value::str("Hola"));
        let values = vec![
            Value::Null,
            Value::str("texto"),
            Value::Bool(true),
            Value::Int(7),
            Value::Double(1.5),
            Value::Timestamp("2026-01-15T10:00:00Z".into()),
            Value::Array(vec![Value::Int(1), Value::str("dos")]),
            Value::Map(map),
        ];
        for value in values {
            let json = value.to_json();
            assert_eq!(
                Value::from_json(&json),
                Some(value.clone()),
                "falló {value:?}"
            );
        }
    }

    #[test]
    fn un_documento_expone_id_y_campos() {
        let doc: Document = serde_json::from_value(json!({
            "name": "projects/p/databases/(default)/documents/notes/abc",
            "updateTime": "2026-01-15T10:00:00Z",
            "fields": {
                "title": { "stringValue": "Nota" },
                "version": { "integerValue": "3" },
                "memberIds": { "arrayValue": { "values": [{ "stringValue": "u1" }] } }
            }
        }))
        .unwrap();
        assert_eq!(doc.id(), "abc");
        assert_eq!(doc.string("title"), "Nota");
        assert_eq!(doc.int("version"), 3);
        assert_eq!(doc.strings("memberIds"), vec!["u1"]);
        assert_eq!(doc.update_time.as_deref(), Some("2026-01-15T10:00:00Z"));
    }

    #[test]
    fn la_consulta_arma_el_filtro_de_membresia() {
        let query = Query::new("notes")
            .member_of("uid-1")
            .order_by("updatedAt", "DESCENDING")
            .select(&["title", "version"])
            .limit(200);
        let body = query.to_body();
        assert_eq!(body["from"][0]["collectionId"], "notes");
        assert_eq!(body["limit"], 200);
        assert_eq!(
            body["where"]["fieldFilter"]["field"]["fieldPath"],
            "memberIds"
        );
        assert_eq!(body["where"]["fieldFilter"]["op"], "ARRAY_CONTAINS");
        assert_eq!(body["orderBy"][0]["direction"], "DESCENDING");
        assert_eq!(body["select"]["fields"][0]["fieldPath"], "title");
    }

    #[test]
    fn una_escritura_con_update_time_lleva_precondicion() {
        let store = RestStore::new("md-sync-app", "token", "uid").unwrap();
        let write = Write::new("notes", "abc")
            .set("title", Value::str("Nota"))
            .transform("updatedAt", Transform::ServerTimestamp)
            .update_time(Some("2026-01-15T10:00:00Z".into()));
        let json = store.write_json(&write);
        assert_eq!(
            json["currentDocument"]["updateTime"],
            "2026-01-15T10:00:00Z"
        );
        assert_eq!(json["update"]["fields"]["title"]["stringValue"], "Nota");
        assert_eq!(
            json["updateTransforms"][0]["setToServerValue"],
            "REQUEST_TIME"
        );
    }
}
