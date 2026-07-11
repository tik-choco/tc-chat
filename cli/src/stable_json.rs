//! Rust port of tc-chat's `src/lib/wireSign.ts` `stableStringify`: deterministic,
//! key-sorted JSON with `null`/absent fields never emitted for object entries
//! that were `undefined` on the TS side (Rust callers simply omit the key
//! from the `serde_json::Map` before calling this).
//!
//! tc-chat sorts object keys with `String.prototype.localeCompare`. Every
//! wire message field name in this codebase (id, fromId, fromName,
//! timestamp, kind, cid, mimeType, fileName, fileSize, type, title,
//! description, roles, tags, signature, ...) is plain lowercase/camelCase
//! ASCII, and `localeCompare` on such strings agrees with ordinary code
//! point order — so `str::cmp` here produces byte-identical output to the
//! TS implementation for every payload this CLI signs or verifies.

use serde_json::Value;

pub fn stable_stringify(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            let body = entries
                .iter()
                .map(|(key, val)| format!("{}:{}", serde_json::to_string(key).unwrap(), stable_stringify(val)))
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
        Value::Array(items) => {
            let body = items.iter().map(stable_stringify).collect::<Vec<_>>().join(",");
            format!("[{body}]")
        }
        _ => serde_json::to_string(value).unwrap(),
    }
}

/// Builds the signing payload for a wire message: every field except
/// `signature`, stably stringified. Mirrors `signingPayload` in wireSign.ts.
pub fn signing_payload(wire: &serde_json::Map<String, Value>) -> String {
    let mut unsigned = wire.clone();
    unsigned.remove("signature");
    stable_stringify(&Value::Object(unsigned))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_object_keys() {
        let value = json!({"b": 1, "a": 2});
        assert_eq!(stable_stringify(&value), r#"{"a":2,"b":1}"#);
    }

    #[test]
    fn preserves_array_order() {
        let value = json!({"tags": ["b", "a"]});
        assert_eq!(stable_stringify(&value), r#"{"tags":["b","a"]}"#);
    }

    #[test]
    fn excludes_signature_from_signing_payload() {
        let mut map = serde_json::Map::new();
        map.insert("fromId".to_string(), json!("did:key:z6Mk..."));
        map.insert("signature".to_string(), json!("sig"));
        assert_eq!(signing_payload(&map), r#"{"fromId":"did:key:z6Mk..."}"#);
    }

    #[test]
    fn matches_a_known_chat_wire_payload() {
        let mut map = serde_json::Map::new();
        map.insert("type".to_string(), json!("tc-chat:message"));
        map.insert("id".to_string(), json!("abc"));
        map.insert("fromId".to_string(), json!("did:key:z6Mk"));
        map.insert("fromName".to_string(), json!("自分"));
        map.insert("timestamp".to_string(), json!(1234567890123u64));
        map.insert("kind".to_string(), json!("text"));
        map.insert("cid".to_string(), json!("bafy..."));
        // Matches JS: `JSON.stringify({ cid: "bafy...", fromId: "did:key:z6Mk",
        // fromName: "自分", id: "abc", kind: "text", timestamp: 1234567890123,
        // type: "tc-chat:message" })` with keys sorted.
        assert_eq!(
            signing_payload(&map),
            r#"{"cid":"bafy...","fromId":"did:key:z6Mk","fromName":"自分","id":"abc","kind":"text","timestamp":1234567890123,"type":"tc-chat:message"}"#
        );
    }
}
