//! Rust port of tc-chat's `src/crypto/didIdentity.ts` (did:key Ed25519 +
//! base58btc + PKCS8 private key storage), kept byte-for-byte compatible so
//! signatures produced here verify against the web app and vice versa:
//!   - public key multicodec: 0xed 0x01 (Ed25519), base58btc, "z" prefix
//!   - private key: PKCS8 DER, base64-encoded
//!   - signature: raw 64-byte Ed25519 signature, base64url (no padding)
//!
//! The on-disk schema mirrors tc-storage/tc-chat's localStorage identity
//! record (did, method, keyType, publicKeyMultibase, privateKeyPkcs8,
//! createdAt) so the two apps stay interoperable.

use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD as BASE64_URL};
use base64::Engine;
use ed25519_dalek::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

const ED25519_MULTICODEC: [u8; 2] = [0xed, 0x01];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DidIdentity {
    pub did: String,
    pub method: String,
    #[serde(rename = "keyType")]
    pub key_type: String,
    #[serde(rename = "publicKeyMultibase")]
    pub public_key_multibase: String,
    #[serde(rename = "privateKeyPkcs8")]
    pub private_key_pkcs8: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

impl DidIdentity {
    pub fn signing_key(&self) -> Result<SigningKey, String> {
        let der = BASE64_STANDARD
            .decode(&self.private_key_pkcs8)
            .map_err(|e| format!("invalid privateKeyPkcs8 base64: {e}"))?;
        SigningKey::from_pkcs8_der(&der).map_err(|e| format!("invalid PKCS8 private key: {e}"))
    }

    pub fn sign(&self, payload: &str) -> Result<String, String> {
        let signing_key = self.signing_key()?;
        let signature: Signature = signing_key.sign(payload.as_bytes());
        Ok(BASE64_URL.encode(signature.to_bytes()))
    }
}

/// Default location for the persisted identity: `~/.tc-chat-cli/identity.json`.
pub fn default_identity_path() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME").ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "HOME environment variable is not set")
    })?;
    Ok(PathBuf::from(home).join(".tc-chat-cli").join("identity.json"))
}

/// Loads the identity at `path`, generating and persisting a new one if it
/// does not exist yet (mirrors tc-chat's `ensureDidIdentity`).
pub fn ensure_identity(path: &Path) -> io::Result<DidIdentity> {
    if let Some(identity) = load_identity(path)? {
        return Ok(identity);
    }
    let identity = generate_identity();
    save_identity(path, &identity)?;
    Ok(identity)
}

pub fn load_identity(path: &Path) -> io::Result<Option<DidIdentity>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    let identity: DidIdentity = serde_json::from_str(&raw)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("corrupt identity file: {e}")))?;
    Ok(Some(identity))
}

pub fn save_identity(path: &Path, identity: &DidIdentity) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(identity)?;
    fs::write(path, json)
}

pub fn generate_identity() -> DidIdentity {
    let signing_key = SigningKey::generate(&mut rand_core::OsRng);
    identity_from_signing_key(&signing_key)
}

fn identity_from_signing_key(signing_key: &SigningKey) -> DidIdentity {
    let public_key_raw = signing_key.verifying_key().to_bytes();
    let public_key_multibase = public_key_multibase_from_ed25519(&public_key_raw);
    let did = did_key_from_public_key_multibase(&public_key_multibase)
        .expect("just-derived multibase is always a valid Ed25519 did:key");
    let pkcs8_der = signing_key
        .to_pkcs8_der()
        .expect("Ed25519 keys always encode to PKCS8 DER");
    DidIdentity {
        did,
        method: "did:key".to_string(),
        key_type: "Ed25519".to_string(),
        public_key_multibase,
        private_key_pkcs8: BASE64_STANDARD.encode(pkcs8_der.as_bytes()),
        created_at: OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .expect("RFC3339 formatting never fails for now_utc()"),
    }
}

pub fn public_key_multibase_from_ed25519(public_key_raw: &[u8; 32]) -> String {
    let mut bytes = Vec::with_capacity(34);
    bytes.extend_from_slice(&ED25519_MULTICODEC);
    bytes.extend_from_slice(public_key_raw);
    format!("z{}", crate::base58::encode(&bytes))
}

pub fn did_key_from_public_key_multibase(public_key_multibase: &str) -> Result<String, String> {
    ed25519_public_key_from_multibase(public_key_multibase)?;
    Ok(format!("did:key:{public_key_multibase}"))
}

pub fn did_key_from_ed25519_public_key(public_key_raw: &[u8; 32]) -> String {
    let multibase = public_key_multibase_from_ed25519(public_key_raw);
    did_key_from_public_key_multibase(&multibase).expect("just-derived multibase is always valid")
}

pub fn ed25519_public_key_from_did_key(did: &str) -> Option<[u8; 32]> {
    let multibase = did.strip_prefix("did:key:")?;
    ed25519_public_key_from_multibase(multibase).ok()
}

pub fn is_ed25519_did_key(did: &str) -> bool {
    ed25519_public_key_from_did_key(did).is_some()
}

fn ed25519_public_key_from_multibase(public_key_multibase: &str) -> Result<[u8; 32], String> {
    let encoded = public_key_multibase
        .strip_prefix('z')
        .ok_or("DID key must use base58btc multibase")?;
    let bytes = crate::base58::decode(encoded).map_err(|e| e.to_string())?;
    if bytes.len() != 34 || bytes[0] != ED25519_MULTICODEC[0] || bytes[1] != ED25519_MULTICODEC[1] {
        return Err("DID key is not an Ed25519 public key".to_string());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes[2..]);
    Ok(key)
}

/// Verifies a base64url signature against `payload`, keyed by `did`. Mirrors
/// `verifyStringWithDid` — never trust peer-supplied DIDs/signatures.
pub fn verify_with_did(did: &str, payload: &str, signature: &str) -> bool {
    let Some(public_key_raw) = ed25519_public_key_from_did_key(did) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key_raw) else {
        return false;
    };
    let signature_bytes = match BASE64_URL.decode(signature) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let Ok(signature_bytes) = <[u8; 64]>::try_from(signature_bytes.as_slice()) else {
        return false;
    };
    let signature = Signature::from_bytes(&signature_bytes);
    verifying_key.verify(payload.as_bytes(), &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixed vector shared with tc-chat's `src/crypto/didIdentity.test.ts`:
    /// a 32-byte public key with only the first and last byte set must
    /// derive this exact did:key.
    #[test]
    fn matches_tc_chat_fixed_vector() {
        let mut public_key = [0u8; 32];
        public_key[0] = 1;
        public_key[31] = 255;

        let did = did_key_from_ed25519_public_key(&public_key);

        assert_eq!(did, "did:key:z6MkeXATEjyXENzBXBxgC5EHk2JE5aqd7qMGGtDpLUH1e2X8");
        assert!(is_ed25519_did_key(&did));
        assert_eq!(ed25519_public_key_from_did_key(&did), Some(public_key));
    }

    #[test]
    fn rejects_malformed_or_non_ed25519_dids() {
        assert_eq!(ed25519_public_key_from_did_key("not-a-did"), None);
        assert!(!is_ed25519_did_key("did:key:not-ed25519"));
    }

    #[test]
    fn signs_and_verifies_payloads_and_rejects_tampering() {
        let identity = generate_identity();
        let signature = identity.sign("tc-chat payload").unwrap();

        assert!(verify_with_did(&identity.did, "tc-chat payload", &signature));
        assert!(!verify_with_did(&identity.did, "tampered payload", &signature));
    }

    #[test]
    fn rejects_signature_checked_against_a_different_did() {
        let identity = generate_identity();
        let other = generate_identity();
        let signature = identity.sign("payload").unwrap();

        assert_ne!(other.did, identity.did);
        assert!(!verify_with_did(&other.did, "payload", &signature));
    }

    #[test]
    fn persists_and_reloads_identity_from_disk() {
        let dir = std::env::temp_dir().join(format!("tc-chat-cli-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join("identity.json");

        let first = ensure_identity(&path).unwrap();
        let second = ensure_identity(&path).unwrap();
        assert_eq!(first.did, second.did);

        let loaded = load_identity(&path).unwrap().unwrap();
        assert_eq!(loaded.did, first.did);

        fs::remove_dir_all(&dir).ok();
    }
}
