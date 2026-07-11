//! Consumer side of tc-mistllm's "LLM Network" mist protocol, multiplexed
//! over the same chat room the bot already occupies (mistlib-native is a
//! process-global singleton with exactly one room per process — see
//! `.mistlib-src/mistlib-native/src/app.rs` `join_room`/`leave_room` — so the
//! bot cannot join a separate room for LLM traffic; providers just join the
//! bot's chat room instead).
//!
//! `ProtocolMessage`/`encode_message`/`decode_message` mirror
//! tc-mistllm/cli/src/protocol.rs field-for-field (same JSON shape:
//! `{"v":1,"type":"llm_request",...}` etc.) so this consumer talks to
//! tc-mistllm's `provide` CLI and tc-translate's browser provider mode
//! unmodified. `ConsumerCore` is adapted from tc-mistllm/cli/src/server.rs's
//! `ConsumerCore` (Mutex+Condvar request/response correlation, seq-ordered
//! chunk reassembly) — same design, network I/O injected via a `send`
//! closure so it stays unit-testable without mistlib.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use uuid::Uuid;

use crate::llm::ChatMessage;

const ROLES: [&str; 3] = ["system", "user", "assistant"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolMessage {
    LlmRequest {
        id: String,
        messages: Vec<ChatMessage>,
        model: Option<String>,
    },
    LlmResponseChunk {
        id: String,
        delta: String,
        /// 0-based, per-request, monotonically increasing. `None` means legacy/unordered delivery.
        seq: Option<u64>,
    },
    LlmResponseDone {
        id: String,
        content: Option<String>,
    },
    LlmError {
        id: String,
        message: String,
    },
    ProviderHello,
    ConsumerHello,
}

/// Encodes a protocol message to JSON UTF-8 bytes for send_message().
pub fn encode_message(msg: &ProtocolMessage) -> Vec<u8> {
    let value = match msg {
        ProtocolMessage::LlmRequest { id, messages, model } => {
            let mut value = json!({
                "v": 1,
                "type": "llm_request",
                "id": id,
                "messages": messages
                    .iter()
                    .map(|m| json!({"role": m.role, "content": m.content}))
                    .collect::<Vec<_>>(),
            });
            if let Some(model) = model {
                value["model"] = json!(model);
            }
            value
        }
        ProtocolMessage::LlmResponseChunk { id, delta, seq } => {
            let mut value = json!({"v": 1, "type": "llm_response_chunk", "id": id, "delta": delta});
            if let Some(seq) = seq {
                value["seq"] = json!(seq);
            }
            value
        }
        ProtocolMessage::LlmResponseDone { id, content } => {
            let mut value = json!({"v": 1, "type": "llm_response_done", "id": id});
            if let Some(content) = content {
                value["content"] = json!(content);
            }
            value
        }
        ProtocolMessage::LlmError { id, message } => {
            json!({"v": 1, "type": "llm_error", "id": id, "message": message})
        }
        ProtocolMessage::ProviderHello => json!({"v": 1, "type": "provider_hello"}),
        ProtocolMessage::ConsumerHello => json!({"v": 1, "type": "consumer_hello"}),
    };
    serde_json::to_vec(&value).expect("protocol messages always serialize")
}

/// Decodes and validates bytes received from a peer. Returns `None` for
/// anything that doesn't match the expected shape (including tc-chat's own
/// `ChatWireMessage` JSON, which this is deliberately multiplexed alongside)
/// — callers must never trust peer-supplied data.
pub fn decode_message(data: &[u8]) -> Option<ProtocolMessage> {
    let text = std::str::from_utf8(data).ok()?;
    let value: Value = serde_json::from_str(text).ok()?;
    let obj = value.as_object()?;

    if obj.get("v")?.as_i64()? != 1 {
        return None;
    }
    let msg_type = obj.get("type")?.as_str()?;

    match msg_type {
        "provider_hello" => Some(ProtocolMessage::ProviderHello),
        "consumer_hello" => Some(ProtocolMessage::ConsumerHello),
        "llm_request" => {
            let id = non_empty_string(obj.get("id"))?;
            let messages_val = obj.get("messages")?.as_array()?;
            if messages_val.is_empty() {
                return None;
            }
            let mut messages = Vec::with_capacity(messages_val.len());
            for entry in messages_val {
                let entry_obj = entry.as_object()?;
                let role = entry_obj.get("role")?.as_str()?;
                if !ROLES.contains(&role) {
                    return None;
                }
                let content = entry_obj.get("content")?.as_str()?.to_string();
                messages.push(ChatMessage { role: role.to_string(), content });
            }
            let model = optional_string(obj.get("model"))?;
            Some(ProtocolMessage::LlmRequest { id, messages, model })
        }
        "llm_response_chunk" => {
            let id = non_empty_string(obj.get("id"))?;
            let delta = obj.get("delta")?.as_str()?.to_string();
            let seq = optional_seq(obj.get("seq"))?;
            Some(ProtocolMessage::LlmResponseChunk { id, delta, seq })
        }
        "llm_response_done" => {
            let id = non_empty_string(obj.get("id"))?;
            let content = optional_string(obj.get("content"))?;
            Some(ProtocolMessage::LlmResponseDone { id, content })
        }
        "llm_error" => {
            let id = non_empty_string(obj.get("id"))?;
            let message = obj.get("message")?.as_str()?.to_string();
            Some(ProtocolMessage::LlmError { id, message })
        }
        _ => None,
    }
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    let s = value?.as_str()?;
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn optional_string(value: Option<&Value>) -> Option<Option<String>> {
    match value {
        None => Some(None),
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        Some(_) => None,
    }
}

fn optional_seq(value: Option<&Value>) -> Option<Option<u64>> {
    match value {
        None => Some(None),
        Some(Value::Null) => Some(None),
        Some(v) => v.as_u64().map(Some),
    }
}

#[derive(Debug)]
pub enum RequestError {
    Timeout(String),
    Provider(String),
    NoProvider,
}

impl std::fmt::Display for RequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RequestError::Timeout(m) | RequestError::Provider(m) => write!(f, "{m}"),
            RequestError::NoProvider => write!(f, "ルームにLLM providerが見つかりません (no LLM provider in room)"),
        }
    }
}

impl std::error::Error for RequestError {}

#[derive(Default)]
struct PendingState {
    chunks: Vec<String>,
    content: Option<String>,
    error: Option<String>,
    finished: bool,
    /// Next seq expected from a sequenced sender; out-of-order chunks buffer here until it's their turn.
    next_seq: u64,
    buffered: BTreeMap<u64, String>,
}

impl PendingState {
    /// Applies a chunk, reordering by `seq` when present. Chunks without a
    /// seq (legacy senders) are applied immediately in arrival order.
    fn apply_chunk(&mut self, delta: String, seq: Option<u64>) {
        let Some(seq) = seq else {
            self.chunks.push(delta);
            return;
        };

        if seq < self.next_seq {
            return; // stale duplicate
        }
        if seq > self.next_seq {
            self.buffered.insert(seq, delta);
            return;
        }

        self.chunks.push(delta);
        self.next_seq += 1;
        while let Some(next) = self.buffered.remove(&self.next_seq) {
            self.chunks.push(next);
            self.next_seq += 1;
        }
    }
}

struct Pending {
    state: Mutex<PendingState>,
    cv: Condvar,
}

pub type SendFn = dyn Fn(&str, ProtocolMessage) + Send + Sync;

/// Sends llm_request messages to a provider peer and correlates streamed
/// responses back to the caller by request id, plus tracks which peer has
/// most recently announced itself as a provider via `provider_hello`.
///
/// Network I/O is injected via `send(to_id, msg)` so this stays unit-testable
/// without mistlib, mirroring tc-mistllm's `ConsumerCore`.
pub struct ConsumerCore {
    send: Box<SendFn>,
    timeout: Duration,
    pending: Mutex<HashMap<String, Arc<Pending>>>,
    /// The most recent peer to send `provider_hello`. `None` until one is seen.
    current_provider: Mutex<Option<String>>,
}

impl ConsumerCore {
    pub fn new(send: Box<SendFn>, timeout: Duration) -> Self {
        Self { send, timeout, pending: Mutex::new(HashMap::new()), current_provider: Mutex::new(None) }
    }

    /// The most recently announced provider peer id, if any.
    pub fn current_provider(&self) -> Option<String> {
        self.current_provider.lock().expect("current_provider mutex poisoned").clone()
    }

    /// Forgets `peer_id` as the current provider if it just disconnected, so
    /// a stale peer id isn't targeted by a future request.
    pub fn forget_provider_if(&self, peer_id: &str) {
        let mut guard = self.current_provider.lock().expect("current_provider mutex poisoned");
        if guard.as_deref() == Some(peer_id) {
            *guard = None;
        }
    }

    /// Sends a chat request to the current provider and blocks until the full
    /// reply is assembled (or the request errors/times out). `on_delta` is
    /// invoked with each chunk as it arrives, in seq order. Returns
    /// `RequestError::NoProvider` immediately (no network round-trip, no
    /// wait) if no provider has announced itself yet.
    pub fn request(&self, messages: Vec<ChatMessage>, model: Option<String>, mut on_delta: impl FnMut(&str)) -> Result<String, RequestError> {
        let Some(provider_id) = self.current_provider() else {
            return Err(RequestError::NoProvider);
        };

        let req_id = Uuid::new_v4().to_string();
        let pending = Arc::new(Pending { state: Mutex::new(PendingState::default()), cv: Condvar::new() });
        self.pending.lock().expect("pending mutex poisoned").insert(req_id.clone(), pending.clone());

        let result = (|| {
            (self.send)(&provider_id, ProtocolMessage::LlmRequest { id: req_id.clone(), messages, model });

            let deadline = Instant::now() + self.timeout;
            let mut delivered = 0usize;
            let mut guard = pending.state.lock().expect("pending state mutex poisoned");
            loop {
                if delivered < guard.chunks.len() {
                    let new_chunks: Vec<String> = guard.chunks[delivered..].to_vec();
                    delivered = guard.chunks.len();
                    for chunk in &new_chunks {
                        on_delta(chunk);
                    }
                    continue;
                }
                if guard.finished {
                    return if let Some(err) = guard.error.clone() {
                        Err(RequestError::Provider(err))
                    } else {
                        Ok(guard.content.clone().unwrap_or_else(|| guard.chunks.concat()))
                    };
                }
                let now = Instant::now();
                if now >= deadline {
                    return Err(RequestError::Timeout(format!("LLM providerの応答がタイムアウトしました (id={req_id})")));
                }
                let wait = (deadline - now).min(Duration::from_millis(500));
                let (g, _) = pending.cv.wait_timeout(guard, wait).expect("condvar wait poisoned");
                guard = g;
            }
        })();

        self.pending.lock().expect("pending mutex poisoned").remove(&req_id);
        result
    }

    /// Feeds an incoming protocol message from `from_id` into request
    /// correlation / provider tracking. No-ops for `llm_request` (we are a
    /// consumer, never a provider) and `consumer_hello` (irrelevant to us).
    pub fn handle_message(&self, from_id: &str, msg: ProtocolMessage) {
        match msg {
            ProtocolMessage::ProviderHello => {
                *self.current_provider.lock().expect("current_provider mutex poisoned") = Some(from_id.to_string());
            }
            ProtocolMessage::ConsumerHello | ProtocolMessage::LlmRequest { .. } => {}
            ProtocolMessage::LlmResponseChunk { id, delta, seq } => self.apply(id, Some((delta, seq)), None, None, false),
            ProtocolMessage::LlmResponseDone { id, content } => self.apply(id, None, content, None, true),
            ProtocolMessage::LlmError { id, message } => self.apply(id, None, None, Some(message), true),
        }
    }

    fn apply(&self, req_id: String, chunk: Option<(String, Option<u64>)>, content: Option<String>, error: Option<String>, finished: bool) {
        let pending = self.pending.lock().expect("pending mutex poisoned").get(&req_id).cloned();
        let Some(pending) = pending else { return };

        {
            let mut guard = pending.state.lock().expect("pending state mutex poisoned");
            if let Some((delta, seq)) = chunk {
                guard.apply_chunk(delta, seq);
            }
            if content.is_some() {
                guard.content = content;
            }
            if error.is_some() {
                guard.error = error;
            }
            if finished {
                guard.finished = true;
            }
        }
        pending.cv.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(v: Value) -> Vec<u8> {
        serde_json::to_vec(&v).unwrap()
    }

    #[test]
    fn round_trips_llm_request() {
        let m = ProtocolMessage::LlmRequest {
            id: "abc".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
            model: Some("gpt-4o".into()),
        };
        assert_eq!(decode_message(&encode_message(&m)), Some(m));
    }

    #[test]
    fn round_trips_llm_response_chunk_with_seq() {
        let m = ProtocolMessage::LlmResponseChunk { id: "abc".into(), delta: "he".into(), seq: Some(3) };
        assert_eq!(decode_message(&encode_message(&m)), Some(m));
    }

    #[test]
    fn round_trips_hello_messages() {
        assert_eq!(decode_message(&encode_message(&ProtocolMessage::ProviderHello)), Some(ProtocolMessage::ProviderHello));
        assert_eq!(decode_message(&encode_message(&ProtocolMessage::ConsumerHello)), Some(ProtocolMessage::ConsumerHello));
    }

    #[test]
    fn rejects_malformed_json() {
        assert_eq!(decode_message(b"not json"), None);
    }

    #[test]
    fn rejects_tc_chat_message_json_as_llm_protocol() {
        // A tc-chat ChatWireMessage has no "v" field, so it must never be
        // mistaken for an LLM protocol message when multiplexed in the same room.
        let chat_wire = msg(json!({"type": "tc-chat:message", "id": "m1", "fromId": "did:key:z1"}));
        assert_eq!(decode_message(&chat_wire), None);
    }

    #[test]
    fn rejects_unknown_message_types() {
        assert_eq!(decode_message(&msg(json!({"v": 1, "type": "evil_type"}))), None);
    }

    #[test]
    fn rejects_llm_request_with_empty_messages() {
        assert_eq!(decode_message(&msg(json!({"v": 1, "type": "llm_request", "id": "a", "messages": []}))), None);
    }

    #[test]
    fn requests_without_a_provider_fail_fast_without_sending() {
        let sent = Arc::new(Mutex::new(false));
        let sent_clone = sent.clone();
        let consumer = ConsumerCore::new(Box::new(move |_, _| *sent_clone.lock().unwrap() = true), Duration::from_millis(50));

        let err = consumer.request(vec![ChatMessage { role: "user".into(), content: "hi".into() }], None, |_| {}).unwrap_err();

        assert!(matches!(err, RequestError::NoProvider));
        assert!(!*sent.lock().unwrap());
    }

    #[test]
    fn provider_hello_registers_the_sender_as_current_provider() {
        let consumer = ConsumerCore::new(Box::new(|_, _| {}), Duration::from_millis(50));
        assert_eq!(consumer.current_provider(), None);

        consumer.handle_message("peerA", ProtocolMessage::ProviderHello);
        assert_eq!(consumer.current_provider(), Some("peerA".to_string()));

        // A later hello from a different peer replaces the tracked provider.
        consumer.handle_message("peerB", ProtocolMessage::ProviderHello);
        assert_eq!(consumer.current_provider(), Some("peerB".to_string()));
    }

    #[test]
    fn forget_provider_if_clears_only_the_matching_peer() {
        let consumer = ConsumerCore::new(Box::new(|_, _| {}), Duration::from_millis(50));
        consumer.handle_message("peerA", ProtocolMessage::ProviderHello);

        consumer.forget_provider_if("peerB");
        assert_eq!(consumer.current_provider(), Some("peerA".to_string()));

        consumer.forget_provider_if("peerA");
        assert_eq!(consumer.current_provider(), None);
    }

    #[test]
    fn request_sends_to_current_provider_and_assembles_reply() {
        let sent: Arc<Mutex<Vec<(String, ProtocolMessage)>>> = Arc::new(Mutex::new(Vec::new()));
        let sent_clone = sent.clone();
        let consumer = Arc::new(ConsumerCore::new(
            Box::new(move |to_id, msg| sent_clone.lock().unwrap().push((to_id.to_string(), msg))),
            Duration::from_secs(5),
        ));
        consumer.handle_message("peerA", ProtocolMessage::ProviderHello);

        let consumer_for_thread = consumer.clone();
        let handle = std::thread::spawn(move || {
            consumer_for_thread.request(vec![ChatMessage { role: "user".into(), content: "hi".into() }], None, |_| {})
        });

        // Wait for the request to be sent, then simulate the provider's streamed reply.
        loop {
            if !sent.lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let req_id = match &sent.lock().unwrap()[0].1 {
            ProtocolMessage::LlmRequest { id, .. } => id.clone(),
            _ => panic!("expected LlmRequest"),
        };
        consumer.handle_message("peerA", ProtocolMessage::LlmResponseChunk { id: req_id.clone(), delta: "He".into(), seq: Some(0) });
        consumer.handle_message("peerA", ProtocolMessage::LlmResponseChunk { id: req_id.clone(), delta: "llo".into(), seq: Some(1) });
        consumer.handle_message("peerA", ProtocolMessage::LlmResponseDone { id: req_id, content: Some("Hello".into()) });

        let result = handle.join().unwrap().unwrap();
        assert_eq!(result, "Hello");
    }

    #[test]
    fn request_reorders_out_of_order_chunks_by_seq() {
        let consumer = Arc::new(ConsumerCore::new(Box::new(|_, _| {}), Duration::from_secs(5)));
        consumer.handle_message("peerA", ProtocolMessage::ProviderHello);

        let consumer_for_thread = consumer.clone();
        let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let received_clone = received.clone();
        let handle = std::thread::spawn(move || {
            consumer_for_thread.request(vec![ChatMessage { role: "user".into(), content: "hi".into() }], None, move |d| {
                received_clone.lock().unwrap().push(d.to_string())
            })
        });

        std::thread::sleep(Duration::from_millis(20));
        let pending_id = consumer.pending.lock().unwrap().keys().next().cloned().unwrap();
        // seq 1 arrives before seq 0: it must be buffered, not delivered early.
        consumer.handle_message("peerA", ProtocolMessage::LlmResponseChunk { id: pending_id.clone(), delta: "llo".into(), seq: Some(1) });
        std::thread::sleep(Duration::from_millis(20));
        assert!(received.lock().unwrap().is_empty(), "out-of-order chunk must not be delivered before its predecessor");

        consumer.handle_message("peerA", ProtocolMessage::LlmResponseChunk { id: pending_id.clone(), delta: "He".into(), seq: Some(0) });
        consumer.handle_message("peerA", ProtocolMessage::LlmResponseDone { id: pending_id, content: None });

        let result = handle.join().unwrap().unwrap();
        assert_eq!(*received.lock().unwrap(), vec!["He".to_string(), "llo".to_string()]);
        assert_eq!(result, "Hello");
    }

    #[test]
    fn request_times_out_when_provider_never_responds() {
        let consumer = ConsumerCore::new(Box::new(|_, _| {}), Duration::from_millis(50));
        consumer.handle_message("peerA", ProtocolMessage::ProviderHello);

        let err = consumer.request(vec![ChatMessage { role: "user".into(), content: "hi".into() }], None, |_| {}).unwrap_err();
        assert!(matches!(err, RequestError::Timeout(_)));
    }

    #[test]
    fn request_surfaces_llm_error_from_provider() {
        let consumer = Arc::new(ConsumerCore::new(Box::new(|_, _| {}), Duration::from_secs(5)));
        consumer.handle_message("peerA", ProtocolMessage::ProviderHello);

        let consumer_for_thread = consumer.clone();
        let handle = std::thread::spawn(move || {
            consumer_for_thread.request(vec![ChatMessage { role: "user".into(), content: "hi".into() }], None, |_| {})
        });

        std::thread::sleep(Duration::from_millis(20));
        let pending_id = consumer.pending.lock().unwrap().keys().next().cloned().unwrap();
        consumer.handle_message("peerA", ProtocolMessage::LlmError { id: pending_id, message: "provider offline".into() });

        let err = handle.join().unwrap().unwrap_err();
        match err {
            RequestError::Provider(message) => assert_eq!(message, "provider offline"),
            other => panic!("expected Provider error, got {other:?}"),
        }
    }

    #[test]
    fn handle_message_ignores_llm_request_and_consumer_hello() {
        let consumer = ConsumerCore::new(Box::new(|_, _| panic!("should not send")), Duration::from_millis(50));
        consumer.handle_message("peerA", ProtocolMessage::ConsumerHello);
        consumer.handle_message(
            "peerA",
            ProtocolMessage::LlmRequest { id: "x".into(), messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }], model: None },
        );
        assert_eq!(consumer.current_provider(), None);
    }
}
