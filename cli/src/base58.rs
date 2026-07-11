//! Thin wrapper around the `bs58` crate using the Bitcoin/base58btc alphabet,
//! matching tc-chat's `src/crypto/didIdentity.ts` `encodeBase58`/`decodeBase58`
//! (which also use the Bitcoin alphabet). Kept as its own module so the
//! did:key logic in `identity.rs` reads independently of the encoding choice.

pub fn encode(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

pub fn decode(value: &str) -> Result<Vec<u8>, bs58::decode::Error> {
    bs58::decode(value).into_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_arbitrary_bytes() {
        let bytes = [0u8, 0, 1, 2, 255, 254, 3];
        let encoded = encode(&bytes);
        assert_eq!(decode(&encoded).unwrap(), bytes);
    }
}
