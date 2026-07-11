//! The `run` (resident bot) and `chat` (interactive) subcommands. Both join
//! a room, verify+archive every incoming message via `archive::archive_incoming`,
//! and replay archived history to newly joined peers via
//! `archive::replay_history_to` — so the interactive mode gets the exact same
//! persistence/history-replay behavior as the resident bot for free.
//!
//! tc-chat's wire protocol (`src/hooks/useChatMessages.ts`) has no built-in
//! history-sync message type — mistlib storage is purely content-addressed
//! (CID -> bytes) with no notion of "give me this room's history". So this
//! bot does not invent a new wire message type either: it unicasts each
//! archived `ChatWireMessage` verbatim (including the original sender's
//! signature) to a newly connected peer via `EVENT_JOIN`. Because the
//! signature covers the original `fromId` and is independent of who
//! relays it, the receiving peer's existing `verifyWire` + `appendMessage`
//! (which already dedupes by message id) accepts replayed history exactly
//! like a live broadcast — no protocol or web-app change required.

use crate::archive::{archive_incoming, replay_history_to};
use crate::identity::DidIdentity;
use crate::node::Network;
use crate::store::RoomStore;
use crate::wire::{short_did, ChatWireMessage};
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

pub fn new_node_id() -> String {
    format!("tc-chat-cli-{}", Uuid::new_v4().simple())
}

/// Runs the resident bot until the process is killed (Ctrl+C). `nostr_relay`
/// overrides mistlib's default Nostr signaling relay list with a single
/// (local) relay when set — see `node.rs`'s module docs.
pub fn run(base_dir: &Path, room_id: &str, nostr_relay: Option<&str>) -> Result<(), String> {
    let store = Arc::new(RoomStore::open(base_dir, room_id).map_err(|e| e.to_string())?);

    let network = Arc::new(Network::new(new_node_id()));
    println!("[run] node_id={} room={room_id} に接続中...", network.node_id());

    let store_for_message = store.clone();
    let network_for_message = network.clone();
    let on_message = move |from_id: &str, data: &[u8]| {
        let Some(wire) = ChatWireMessage::from_json_bytes(data) else { return };
        if let Some(wire) = archive_incoming(&store_for_message, &network_for_message, from_id, wire) {
            println!("[run] メッセージを保存しました id={} from={}", wire.id, wire.from_id);
        }
    };

    let store_for_join = store.clone();
    let network_for_join = network.clone();
    let on_peer_connected = move |peer_id: &str| {
        println!("[run] ピアが接続しました: {peer_id}");
        let replayed = replay_history_to(&store_for_join, &network_for_join, peer_id);
        if replayed > 0 {
            println!("[run] {replayed}件の履歴を{peer_id}へ再送しました");
        }
    };

    let on_peer_disconnected = |peer_id: &str| {
        println!("[run] ピアが切断しました: {peer_id}");
    };

    network.join(room_id, nostr_relay, on_message, on_peer_connected, on_peer_disconnected)?;
    println!("[run] 接続完了。常駐中 (Ctrl+Cで終了)");

    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

/// Runs the `send` subcommand: joins the room just long enough to broadcast
/// one signed text message, then exits. `wait_secs` gives mistlib time to
/// establish peer connections (and to flush the send) before the process
/// leaves the room, since the underlying transport is asynchronous WebRTC.
pub fn send_text(
    identity: &DidIdentity,
    from_name: &str,
    room_id: &str,
    text: &str,
    nostr_relay: Option<&str>,
    wait_secs: u64,
) -> Result<(), String> {
    let network = Network::new(new_node_id());
    println!("[send] node_id={} room={room_id} に接続中...", network.node_id());
    network.join(room_id, nostr_relay, |_, _| {}, |_| {}, |_| {})?;

    std::thread::sleep(Duration::from_secs(wait_secs));

    let cid = network.storage_add(&format!("{}.txt", Uuid::new_v4()), text.as_bytes())?;
    let timestamp = current_timestamp_millis();
    let wire = ChatWireMessage::new_text(identity, from_name, timestamp, cid, Uuid::new_v4().to_string())?;
    network.broadcast_bytes(&wire.to_json_bytes());
    println!("[send] メッセージを送信しました id={}", wire.id);

    std::thread::sleep(Duration::from_secs(wait_secs));
    network.leave();
    Ok(())
}

/// Runs the `chat` subcommand: an interactive REPL over the same room, node,
/// and archive as `run`. Incoming messages are verified via `archive_incoming`
/// (so they are persisted exactly like the resident bot would) and, once
/// verified, rendered as `[<shortDid>] <fromName> ✓: <text>`. Unverified
/// messages are discarded (never rendered), matching `run`'s behavior. Lines
/// typed at the prompt are content-addressed, signed, and broadcast, mirroring
/// `send`.
///
/// Unlike a raw-mode TUI (see `p2p/src/app/chat.rs` for that pattern), this
/// reads plain lines from stdin so the terminal's own line editing (arrow
/// keys, backspace, etc.) keeps working without a `crossterm` dependency. The
/// trade-off: an incoming message printed while the user is mid-line will
/// visually interrupt the unfinished prompt (the underlying stdin buffer is
/// unaffected — only the on-screen line is redrawn) — see README.
pub fn chat(base_dir: &Path, identity: &DidIdentity, from_name: &str, room_id: &str, nostr_relay: Option<&str>) -> Result<(), String> {
    let store = Arc::new(RoomStore::open(base_dir, room_id).map_err(|e| e.to_string())?);
    let network = Arc::new(Network::new(new_node_id()));
    let local_did = identity.did.clone();

    println!("=== tc-chat interactive ===");
    println!("node_id={} room={room_id}", network.node_id());
    println!("メッセージを入力してEnterで送信。Ctrl+Cで終了。");

    let store_for_message = store.clone();
    let network_for_message = network.clone();
    let local_did_for_message = local_did.clone();
    let on_message = move |from_id: &str, data: &[u8]| {
        let Some(wire) = ChatWireMessage::from_json_bytes(data) else { return };
        // Messages we broadcast ourselves loop back through mistlib like any
        // other peer's; skip re-rendering (and re-archiving is harmless but
        // pointless) since `send_line` already printed and archived it.
        if wire.from_id == local_did_for_message {
            return;
        }
        if let Some(wire) = archive_incoming(&store_for_message, &network_for_message, from_id, wire) {
            print_incoming(&store_for_message, &network_for_message, &wire);
        }
    };

    let store_for_join = store.clone();
    let network_for_join = network.clone();
    let on_peer_connected = move |peer_id: &str| {
        let replayed = replay_history_to(&store_for_join, &network_for_join, peer_id);
        print_system_line(&format!("ピアが接続しました: {} (履歴{replayed}件を再送)", short_did(peer_id)));
    };
    let on_peer_disconnected = |peer_id: &str| {
        print_system_line(&format!("ピアが切断しました: {}", short_did(peer_id)));
    };

    network.join(room_id, nostr_relay, on_message, on_peer_connected, on_peer_disconnected)?;

    let stdin = io::stdin();
    print!("> ");
    io::stdout().flush().map_err(|e| e.to_string())?;
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        let text = line.trim();
        if !text.is_empty() {
            if let Err(err) = send_line(&store, &network, identity, from_name, text) {
                eprintln!("エラー: メッセージの送信に失敗しました: {err}");
            }
        }
        print!("> ");
        io::stdout().flush().map_err(|e| e.to_string())?;
    }
    network.leave();
    Ok(())
}

fn send_line(store: &RoomStore, network: &Network, identity: &DidIdentity, from_name: &str, text: &str) -> Result<(), String> {
    let cid = network.storage_add(&format!("{}.txt", Uuid::new_v4()), text.as_bytes())?;
    store.save_cid_content(&cid, text.as_bytes()).map_err(|e| e.to_string())?;
    let timestamp = current_timestamp_millis();
    let wire = ChatWireMessage::new_text(identity, from_name, timestamp, cid, Uuid::new_v4().to_string())?;
    store.append_message(&wire).map_err(|e| e.to_string())?;
    network.broadcast_bytes(&wire.to_json_bytes());
    Ok(())
}

fn print_incoming(store: &RoomStore, network: &Network, wire: &ChatWireMessage) {
    let body = match store.load_cid_content(&wire.cid) {
        Ok(Some(bytes)) => bytes,
        _ => match network.storage_get(&wire.cid) {
            Ok(bytes) => bytes,
            Err(_) => {
                print_system_line(&format!("[{}] {} ✓: (本文の取得に失敗しました)", short_did(&wire.from_id), wire.from_name));
                return;
            }
        },
    };
    let text = if wire.kind == "text" {
        String::from_utf8_lossy(&body).into_owned()
    } else {
        format!("[{}] {}", wire.kind, wire.file_name.clone().unwrap_or_else(|| wire.cid.clone()))
    };
    print_system_line(&format!("[{}] {} ✓: {text}", short_did(&wire.from_id), wire.from_name));
}

/// Prints a line above the current input prompt, then restores the prompt.
fn print_system_line(line: &str) {
    let mut out = io::stdout();
    let _ = write!(out, "\r\x1b[K{line}\r\n> ");
    let _ = out.flush();
}

fn current_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is after 1970")
        .as_millis() as u64
}
