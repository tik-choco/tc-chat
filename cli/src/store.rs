//! Per-room persistence for the bot: `~/.tc-chat-cli/rooms/<roomId>/messages.jsonl`
//! holds one verified `ChatWireMessage` per line (append-only, so it doubles
//! as the room's archive), and `~/.tc-chat-cli/rooms/<roomId>/cids/<cid>`
//! holds the raw bytes fetched from mistlib storage for that message's `cid`.
//!
//! Unlike tc-chat's web `chatStore.ts` (which caps history at 500 messages in
//! localStorage), the CLI bot is the archive of record for peers who were
//! offline, so it never trims history.

use crate::wire::ChatWireMessage;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

pub struct RoomStore {
    root: PathBuf,
}

impl RoomStore {
    /// `base_dir` is typically `~/.tc-chat-cli`; `room_id` is the mist room id.
    pub fn open(base_dir: &Path, room_id: &str) -> io::Result<Self> {
        let root = base_dir.join("rooms").join(room_id);
        fs::create_dir_all(root.join("cids"))?;
        Ok(Self { root })
    }

    fn messages_path(&self) -> PathBuf {
        self.root.join("messages.jsonl")
    }

    fn cid_path(&self, cid: &str) -> PathBuf {
        self.root.join("cids").join(cid)
    }

    /// Appends `wire` to the JSONL archive unless a message with the same id
    /// is already present (peers may legitimately rebroadcast history).
    pub fn append_message(&self, wire: &ChatWireMessage) -> io::Result<()> {
        if self.has_message(&wire.id)? {
            return Ok(());
        }
        let mut file = OpenOptions::new().create(true).append(true).open(self.messages_path())?;
        let mut line = serde_json::to_vec(wire).expect("ChatWireMessage always serializes");
        line.push(b'\n');
        file.write_all(&line)
    }

    pub fn has_message(&self, id: &str) -> io::Result<bool> {
        Ok(self.load_messages()?.iter().any(|m| m.id == id))
    }

    pub fn load_messages(&self) -> io::Result<Vec<ChatWireMessage>> {
        let path = self.messages_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let mut messages = Vec::new();
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(wire) = serde_json::from_str::<ChatWireMessage>(&line) {
                messages.push(wire);
            }
        }
        Ok(messages)
    }

    pub fn save_cid_content(&self, cid: &str, bytes: &[u8]) -> io::Result<()> {
        fs::write(self.cid_path(cid), bytes)
    }

    pub fn load_cid_content(&self, cid: &str) -> io::Result<Option<Vec<u8>>> {
        let path = self.cid_path(cid);
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(fs::read(path)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::generate_identity;

    fn temp_base() -> PathBuf {
        std::env::temp_dir().join(format!("tc-chat-cli-store-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn appends_and_loads_messages_deduplicating_by_id() {
        let base = temp_base();
        let store = RoomStore::open(&base, "room-1").unwrap();
        let identity = generate_identity();
        let wire = ChatWireMessage::new_text(&identity, "tester", 1, "cid-1".to_string(), "msg-1".to_string()).unwrap();

        store.append_message(&wire).unwrap();
        store.append_message(&wire).unwrap();

        let loaded = store.load_messages().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0], wire);

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn saves_and_loads_cid_content() {
        let base = temp_base();
        let store = RoomStore::open(&base, "room-1").unwrap();

        store.save_cid_content("cid-1", b"hello").unwrap();
        assert_eq!(store.load_cid_content("cid-1").unwrap(), Some(b"hello".to_vec()));
        assert_eq!(store.load_cid_content("missing").unwrap(), None);

        fs::remove_dir_all(&base).ok();
    }
}
