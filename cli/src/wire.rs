//! Rust port of tc-chat's `ChatWireMessage` (`src/hooks/useChatMessages.ts`)
//! and the `signWireFields`/`verifyWire` helpers (`src/lib/wireSign.ts`).
//! Field names and JSON shape must match exactly: peers decode this CLI's
//! messages with the same TS types.

use crate::identity::{is_ed25519_did_key, verify_with_did, DidIdentity};
use crate::stable_json::signing_payload;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const WIRE_TYPE: &str = "tc-chat:message";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatWireMessage {
    #[serde(rename = "type")]
    pub kind_tag: String,
    pub id: String,
    #[serde(rename = "fromId")]
    pub from_id: String,
    #[serde(rename = "fromName")]
    pub from_name: String,
    pub timestamp: u64,
    /// The chat message's content kind: "text" | "media" | "file".
    pub kind: String,
    pub cid: String,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "fileName", skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(rename = "fileSize", skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    pub signature: String,
}

impl ChatWireMessage {
    /// Builds and signs a new text message, mirroring `useChatMessages.sendText`.
    pub fn new_text(identity: &DidIdentity, from_name: &str, timestamp: u64, cid: String, id: String) -> Result<Self, String> {
        let mut unsigned = ChatWireMessage {
            kind_tag: WIRE_TYPE.to_string(),
            id,
            from_id: identity.did.clone(),
            from_name: from_name.to_string(),
            timestamp,
            kind: "text".to_string(),
            cid,
            mime_type: None,
            file_name: None,
            file_size: None,
            signature: String::new(),
        };
        unsigned.signature = sign_fields(identity, &unsigned)?;
        Ok(unsigned)
    }

    pub fn to_json_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("ChatWireMessage always serializes")
    }

    pub fn from_json_bytes(data: &[u8]) -> Option<Self> {
        let value: Value = serde_json::from_slice(data).ok()?;
        if value.get("type")?.as_str()? != WIRE_TYPE {
            return None;
        }
        serde_json::from_value(value).ok()
    }

    fn as_signing_map(&self) -> Map<String, Value> {
        let mut value = serde_json::to_value(self).expect("ChatWireMessage always serializes");
        let map = value.as_object_mut().expect("ChatWireMessage serializes to an object");
        map.remove("signature");
        map.clone()
    }
}

/// Signs every field of `wire` except `signature`, mirroring `signWireFields`.
fn sign_fields(identity: &DidIdentity, wire: &ChatWireMessage) -> Result<String, String> {
    if identity.did != wire.from_id {
        return Err("wire fromId does not match the local DID identity".to_string());
    }
    let payload = signing_payload(&wire.as_signing_map());
    identity.sign(&payload)
}

/// Verifies `wire.signature` against every other field, keyed by `wire.fromId`.
/// Mirrors `verifyWire` — untrusted peer input, so this must reject anything
/// that doesn't check out rather than panic.
pub fn verify_wire(wire: &ChatWireMessage) -> bool {
    if !is_ed25519_did_key(&wire.from_id) {
        return false;
    }
    let payload = signing_payload(&wire.as_signing_map());
    verify_with_did(&wire.from_id, &payload, &wire.signature)
}

/// Shortened did:key for compact terminal display. Mirrors tc-chat's
/// `src/lib/util.ts` `shortDid`.
pub fn short_did(did: &str) -> String {
    if did.len() <= 20 {
        did.to_string()
    } else {
        format!("{}…{}", &did[..12], &did[did.len() - 6..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::generate_identity;

    #[test]
    fn shortens_long_dids_and_leaves_short_ones_alone() {
        let long_did = "did:key:z6MkeXATEjyXENzBXBxgC5EHk2JE5aqd7qMGGtDpLUH1e2X8";
        assert_eq!(short_did(long_did), "did:key:z6Mk…H1e2X8");
        assert_eq!(short_did("short"), "short");
    }

    #[test]
    fn signs_and_verifies_a_text_message() {
        let identity = generate_identity();
        let wire = ChatWireMessage::new_text(&identity, "tester", 1_700_000_000_000, "bafy-cid".to_string(), "msg-1".to_string()).unwrap();

        assert!(verify_wire(&wire));
    }

    #[test]
    fn rejects_tampered_fields() {
        let identity = generate_identity();
        let mut wire = ChatWireMessage::new_text(&identity, "tester", 1_700_000_000_000, "bafy-cid".to_string(), "msg-1".to_string()).unwrap();

        wire.from_name = "attacker".to_string();
        assert!(!verify_wire(&wire));
    }

    #[test]
    fn rejects_non_ed25519_did() {
        let identity = generate_identity();
        let mut wire = ChatWireMessage::new_text(&identity, "tester", 1_700_000_000_000, "bafy-cid".to_string(), "msg-1".to_string()).unwrap();
        wire.from_id = "did:key:not-ed25519".to_string();
        assert!(!verify_wire(&wire));
    }

    #[test]
    fn round_trips_json_bytes() {
        let identity = generate_identity();
        let wire = ChatWireMessage::new_text(&identity, "tester", 1_700_000_000_000, "bafy-cid".to_string(), "msg-1".to_string()).unwrap();
        let bytes = wire.to_json_bytes();
        assert_eq!(ChatWireMessage::from_json_bytes(&bytes), Some(wire));
    }

    #[test]
    fn rejects_wrong_message_type() {
        let bytes = serde_json::to_vec(&serde_json::json!({"type": "tc-chat:project-post"})).unwrap();
        assert_eq!(ChatWireMessage::from_json_bytes(&bytes), None);
    }
}
