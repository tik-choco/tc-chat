//! The `bot` subcommand: joins a room like `bot::run` (archiving every
//! incoming message via `archive::archive_incoming`), but additionally treats
//! incoming text messages as conversation turns for an LLM and, when the
//! trigger condition matches, sends the LLM's full reply back into the room
//! as one signed text message.
//!
//! Two LLM backends are supported (`LlmBackend`):
//! - `Api`: calls an OpenAI-compatible HTTP endpoint directly (`llm.rs`).
//! - `Network`: multiplexes tc-mistllm's "LLM Network" mist protocol over
//!   this same chat room (`llm_network.rs`) — a separate provider process
//!   (tc-mistllm's `provide` CLI, or tc-translate's browser provider mode)
//!   joins the same room and answers `llm_request`s. This is necessary
//!   because mistlib-native only supports one room per process, so the bot
//!   cannot join a second, LLM-only room.
//!
//! Pure logic (trigger matching, rolling history, prompt building) lives in
//! free functions/structs below so it is unit-testable without mistlib; only
//! `run` touches `Network`/mistlib.

use crate::archive::{archive_incoming, replay_history_to};
use crate::identity::DidIdentity;
use crate::llm::{call_openai, ChatMessage, OpenAIConfig};
use crate::llm_network::{self, ConsumerCore};
use crate::node::Network;
use crate::store::RoomStore;
use crate::wire::ChatWireMessage;
use std::path::Path;
use std::sync::{Arc, Mutex, TryLockError};
use std::time::Duration;
use uuid::Uuid;

pub const DEFAULT_SYSTEM_PROMPT: &str =
    "あなたはtc-chatのチャットルームに参加しているAIアシスタントです。参加者からのメッセージに対して、自然で簡潔な返信をしてください。";

/// When to reply to an incoming message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerMode {
    /// Reply to every incoming text message.
    All,
    /// Reply only when the message text mentions the bot (its name, or
    /// "@<name>", case-insensitively).
    Mention,
}

impl TriggerMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "all" => Ok(TriggerMode::All),
            "mention" => Ok(TriggerMode::Mention),
            other => Err(format!("不明なtriggerモードです: {other} (all|mentionのいずれかを指定してください)")),
        }
    }
}

/// Returns whether `text` should trigger a reply from a bot named `bot_name`
/// under `mode`.
pub fn should_reply(mode: TriggerMode, bot_name: &str, text: &str) -> bool {
    match mode {
        TriggerMode::All => true,
        TriggerMode::Mention => {
            let lower = text.to_lowercase();
            let name_lower = bot_name.to_lowercase();
            lower.contains(&name_lower) || lower.contains(&format!("@{name_lower}"))
        }
    }
}

/// One turn of conversation history: the speaker's display name and the
/// message text. `role` is derived at prompt-build time from whether the
/// turn came from the bot itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryTurn {
    pub from_bot: bool,
    pub speaker_name: String,
    pub text: String,
}

/// A fixed-capacity FIFO of conversation turns, used as the LLM's context
/// window. Pure/no I/O so it can be unit-tested directly.
pub struct History {
    capacity: usize,
    turns: Vec<HistoryTurn>,
}

impl History {
    pub fn new(capacity: usize) -> Self {
        Self { capacity: capacity.max(1), turns: Vec::new() }
    }

    pub fn push(&mut self, turn: HistoryTurn) {
        self.turns.push(turn);
        if self.turns.len() > self.capacity {
            let overflow = self.turns.len() - self.capacity;
            self.turns.drain(0..overflow);
        }
    }

    pub fn turns(&self) -> &[HistoryTurn] {
        &self.turns
    }
}

/// Builds the chat-completion message list: the system prompt followed by
/// each history turn, mapped to "assistant" (bot's own past replies) or
/// "user" (speaker-prefixed, so the LLM can tell participants apart).
pub fn build_prompt(system_prompt: &str, history: &History) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage { role: "system".to_string(), content: system_prompt.to_string() }];
    for turn in history.turns() {
        if turn.from_bot {
            messages.push(ChatMessage { role: "assistant".to_string(), content: turn.text.clone() });
        } else {
            messages.push(ChatMessage {
                role: "user".to_string(),
                content: format!("{}: {}", turn.speaker_name, turn.text),
            });
        }
    }
    messages
}

/// Which LLM backend answers triggered replies.
pub enum LlmBackend {
    /// Direct OpenAI-compatible HTTP call (`llm.rs`).
    Api(OpenAIConfig),
    /// tc-mistllm's LLM Network protocol multiplexed over the chat room
    /// (`llm_network.rs`). `model` is an optional passthrough to whichever
    /// provider answers.
    Network { model: Option<String>, timeout: Duration },
}

pub struct BotConfig {
    pub bot_name: String,
    pub system_prompt: String,
    pub trigger: TriggerMode,
    pub history_capacity: usize,
    pub backend: LlmBackend,
}

/// Runs the resident LLM bot until the process is killed (Ctrl+C). Joins the
/// room, archives every verified incoming `tc-chat:message` (doubling as an
/// archive bot like `bot::run`), and replies via the configured LLM backend
/// when `config.trigger` matches. When `config.backend` is `Network`, also
/// dispatches tc-mistllm's LLM Network protocol messages multiplexed over
/// this same room to a `ConsumerCore`.
pub fn run(
    base_dir: &Path,
    identity: &DidIdentity,
    room_id: &str,
    nostr_relay: Option<&str>,
    config: BotConfig,
) -> Result<(), String> {
    let store = Arc::new(RoomStore::open(base_dir, room_id).map_err(|e| e.to_string())?);
    let network = Arc::new(Network::new(crate::bot::new_node_id()));
    let local_did = identity.did.clone();

    let backend_label = match &config.backend {
        LlmBackend::Api(_) => "api".to_string(),
        LlmBackend::Network { .. } => "network".to_string(),
    };
    println!(
        "[bot] node_id={} room={room_id} name={} trigger={:?} llm={backend_label} に接続中...",
        network.node_id(),
        config.bot_name,
        config.trigger
    );

    let history = Arc::new(Mutex::new(History::new(config.history_capacity)));
    let llm_busy = Arc::new(Mutex::new(()));
    let http_client = Arc::new(reqwest::blocking::Client::new());

    // Only constructed for the Network backend; the Api backend never touches it.
    let consumer: Option<Arc<ConsumerCore>> = if let LlmBackend::Network { timeout, .. } = &config.backend {
        let network_for_send = network.clone();
        Some(Arc::new(ConsumerCore::new(
            Box::new(move |to_id, msg| network_for_send.send_bytes(to_id, &llm_network::encode_message(&msg))),
            *timeout,
        )))
    } else {
        None
    };
    let config = Arc::new(config);

    let store_for_message = store.clone();
    let network_for_message = network.clone();
    let identity_for_message = identity.clone();
    let local_did_for_message = local_did.clone();
    let history_for_message = history.clone();
    let llm_busy_for_message = llm_busy.clone();
    let http_client_for_message = http_client.clone();
    let config_for_message = config.clone();
    let consumer_for_message = consumer.clone();
    let on_message = move |from_id: &str, data: &[u8]| {
        if let Some(wire) = ChatWireMessage::from_json_bytes(data) {
            handle_chat_wire(
                from_id,
                wire,
                &local_did_for_message,
                &store_for_message,
                &network_for_message,
                &identity_for_message,
                &history_for_message,
                &llm_busy_for_message,
                &http_client_for_message,
                &config_for_message,
                consumer_for_message.as_deref(),
            );
            return;
        }
        if let Some(consumer) = &consumer_for_message {
            if let Some(msg) = llm_network::decode_message(data) {
                consumer.handle_message(from_id, msg);
            }
        }
        // Anything that's neither a tc-chat wire message nor (when the
        // network backend is active) an LLM Network protocol message is
        // silently ignored, matching `bot::run`'s existing behavior.
    };

    let store_for_join = store.clone();
    let network_for_join = network.clone();
    let consumer_for_join = consumer.clone();
    let on_peer_connected = move |peer_id: &str| {
        log(&format!("ピアが接続しました: {peer_id}"));
        let replayed = replay_history_to(&store_for_join, &network_for_join, peer_id);
        if replayed > 0 {
            log(&format!("{replayed}件の履歴を{peer_id}へ再送しました"));
        }
        // Mirrors tc-translate's consumer handshake: announce ourselves to
        // every newly joined peer so a provider that joined before/after us
        // still learns a consumer is present.
        if consumer_for_join.is_some() {
            network_for_join.send_bytes(peer_id, &llm_network::encode_message(&llm_network::ProtocolMessage::ConsumerHello));
        }
    };
    let consumer_for_disconnect = consumer.clone();
    let on_peer_disconnected = move |peer_id: &str| {
        log(&format!("ピアが切断しました: {peer_id}"));
        if let Some(consumer) = &consumer_for_disconnect {
            consumer.forget_provider_if(peer_id);
        }
    };

    network.join(room_id, nostr_relay, on_message, on_peer_connected, on_peer_disconnected)?;

    if consumer.is_some() {
        network.broadcast_bytes(&llm_network::encode_message(&llm_network::ProtocolMessage::ConsumerHello));
    }
    log("接続完了。常駐中 (Ctrl+Cで終了)");

    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_chat_wire(
    from_id: &str,
    wire: ChatWireMessage,
    local_did: &str,
    store: &RoomStore,
    network: &Network,
    identity: &DidIdentity,
    history: &Mutex<History>,
    llm_busy: &Mutex<()>,
    http_client: &reqwest::blocking::Client,
    config: &BotConfig,
    consumer: Option<&ConsumerCore>,
) {
    // Loops back through mistlib for our own broadcasts; already archived
    // and added to history at send time, so skip re-processing.
    if wire.from_id == local_did {
        return;
    }
    let Some(wire) = archive_incoming(store, network, from_id, wire) else {
        return;
    };
    log(&format!("メッセージを保存しました id={} from={}", wire.id, wire.from_id));

    if wire.kind != "text" {
        return;
    }
    let text = match store.load_cid_content(&wire.cid) {
        Ok(Some(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
        _ => match network.storage_get(&wire.cid) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(err) => {
                log(&format!("本文の取得に失敗しました cid={}: {err}", wire.cid));
                return;
            }
        },
    };

    {
        let mut history = history.lock().expect("history mutex poisoned");
        history.push(HistoryTurn { from_bot: false, speaker_name: wire.from_name.clone(), text: text.clone() });
    }

    if !should_reply(config.trigger, &config.bot_name, &text) {
        return;
    }

    // Serialize LLM calls: if one is already in flight, drop this trigger
    // rather than queueing (a simple non-blocking try_lock).
    let guard = match llm_busy.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::WouldBlock) => {
            log("LLM呼び出し中のため、このメッセージへの返信はスキップしました");
            return;
        }
        Err(TryLockError::Poisoned(_)) => {
            log("LLM呼び出しロックが破損しています。返信をスキップしました");
            return;
        }
    };

    let prompt = {
        let history = history.lock().expect("history mutex poisoned");
        build_prompt(&config.system_prompt, &history)
    };

    log("LLMへ問い合わせ中...");
    let reply_result = match &config.backend {
        LlmBackend::Api(llm_config) => call_openai(http_client, llm_config, &prompt).map_err(|e| e.to_string()),
        LlmBackend::Network { model, .. } => {
            let consumer = consumer.expect("consumer must be set when backend is Network");
            consumer.request(prompt, model.clone(), |_delta| {}).map_err(|e| e.to_string())
        }
    };

    match reply_result {
        Ok(reply) => {
            let reply = reply.trim().to_string();
            if reply.is_empty() {
                log("LLMが空の応答を返したため、送信をスキップしました");
            } else {
                match send_text(store, network, identity, &config.bot_name, &reply) {
                    Ok(wire) => {
                        log(&format!("返信を送信しました id={}", wire.id));
                        let mut history = history.lock().expect("history mutex poisoned");
                        history.push(HistoryTurn { from_bot: true, speaker_name: config.bot_name.clone(), text: reply });
                    }
                    Err(err) => log(&format!("返信の送信に失敗しました: {err}")),
                }
            }
        }
        Err(err) => log(&format!("LLM呼び出しに失敗しました: {err}")),
    }
    drop(guard);
}

fn send_text(store: &RoomStore, network: &Network, identity: &DidIdentity, from_name: &str, text: &str) -> Result<ChatWireMessage, String> {
    let cid = network.storage_add(&format!("{}.txt", Uuid::new_v4()), text.as_bytes())?;
    store.save_cid_content(&cid, text.as_bytes()).map_err(|e| e.to_string())?;
    let timestamp = current_timestamp_millis();
    let wire = ChatWireMessage::new_text(identity, from_name, timestamp, cid, Uuid::new_v4().to_string())?;
    store.append_message(&wire).map_err(|e| e.to_string())?;
    network.broadcast_bytes(&wire.to_json_bytes());
    Ok(wire)
}

fn log(message: &str) {
    let timestamp = current_timestamp_millis();
    eprintln!("[bot {timestamp}] {message}");
}

fn current_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is after 1970")
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_trigger_mode() {
        assert_eq!(TriggerMode::parse("all"), Ok(TriggerMode::All));
        assert_eq!(TriggerMode::parse("mention"), Ok(TriggerMode::Mention));
        assert!(TriggerMode::parse("bogus").is_err());
    }

    #[test]
    fn all_mode_always_replies() {
        assert!(should_reply(TriggerMode::All, "tc-bot", "anything at all"));
        assert!(should_reply(TriggerMode::All, "tc-bot", ""));
    }

    #[test]
    fn mention_mode_requires_name_or_at_mention() {
        assert!(should_reply(TriggerMode::Mention, "tc-bot", "hey tc-bot, what's up?"));
        assert!(should_reply(TriggerMode::Mention, "tc-bot", "@tc-bot help"));
        assert!(should_reply(TriggerMode::Mention, "TC-Bot", "tc-bot lowercase match"));
        assert!(!should_reply(TriggerMode::Mention, "tc-bot", "just chatting, no mention"));
    }

    #[test]
    fn history_caps_at_capacity_dropping_oldest_first() {
        let mut history = History::new(2);
        history.push(HistoryTurn { from_bot: false, speaker_name: "a".to_string(), text: "1".to_string() });
        history.push(HistoryTurn { from_bot: false, speaker_name: "a".to_string(), text: "2".to_string() });
        history.push(HistoryTurn { from_bot: false, speaker_name: "a".to_string(), text: "3".to_string() });

        let turns = history.turns();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].text, "2");
        assert_eq!(turns[1].text, "3");
    }

    #[test]
    fn build_prompt_maps_bot_turns_to_assistant_and_others_to_prefixed_user() {
        let mut history = History::new(10);
        history.push(HistoryTurn { from_bot: false, speaker_name: "alice".to_string(), text: "hi".to_string() });
        history.push(HistoryTurn { from_bot: true, speaker_name: "tc-bot".to_string(), text: "hello alice".to_string() });

        let prompt = build_prompt("system persona", &history);

        assert_eq!(prompt.len(), 3);
        assert_eq!(prompt[0], ChatMessage { role: "system".to_string(), content: "system persona".to_string() });
        assert_eq!(prompt[1], ChatMessage { role: "user".to_string(), content: "alice: hi".to_string() });
        assert_eq!(prompt[2], ChatMessage { role: "assistant".to_string(), content: "hello alice".to_string() });
    }
}
