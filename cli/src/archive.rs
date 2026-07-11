//! Shared archive logic used by both the resident `run` bot and the
//! interactive `chat` mode: verifying + persisting an incoming wire message,
//! and replaying archived history to a newly joined peer. Extracted so the
//! two entry points in `bot.rs` never duplicate this logic.

use crate::node::Network;
use crate::store::RoomStore;
use crate::wire::{verify_wire, ChatWireMessage};

/// Verifies `wire`'s signature, fetches its CID content, and appends it to
/// `store`. Returns `Some(wire)` if the message was valid (regardless of
/// whether it was already archived), or `None` if the signature check
/// failed and the message was discarded.
pub fn archive_incoming(store: &RoomStore, network: &Network, from_id: &str, wire: ChatWireMessage) -> Option<ChatWireMessage> {
    if !verify_wire(&wire) {
        eprintln!("署名検証に失敗したメッセージを破棄しました id={} from={from_id}", wire.id);
        return None;
    }
    match network.storage_get(&wire.cid) {
        Ok(bytes) => {
            if let Err(err) = store.save_cid_content(&wire.cid, &bytes) {
                eprintln!("CID内容の保存に失敗しました cid={}: {err}", wire.cid);
            }
        }
        Err(err) => eprintln!("CID内容の取得に失敗しました cid={}: {err}", wire.cid),
    }
    if let Err(err) = store.append_message(&wire) {
        eprintln!("メッセージの保存に失敗しました id={}: {err}", wire.id);
    }
    Some(wire)
}

/// Unicasts every archived message (with its original signature intact) to
/// `peer_id`. Returns the number of messages replayed.
pub fn replay_history_to(store: &RoomStore, network: &Network, peer_id: &str) -> usize {
    let messages = match store.load_messages() {
        Ok(messages) => messages,
        Err(err) => {
            eprintln!("履歴の読み込みに失敗しました: {err}");
            return 0;
        }
    };
    for wire in &messages {
        network.send_bytes(peer_id, &wire.to_json_bytes());
    }
    messages.len()
}
