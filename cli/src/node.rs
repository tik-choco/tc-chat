//! Thin wrapper around mistlib-native's free-function API (a global-singleton
//! engine — one node per process). Isolated here so the rest of the CLI
//! (identity/wire/store/bot/chatbot/llm_network and their tests) never needs
//! to touch mistlib directly, following the same layering as
//! tc-mistllm/cli/src/node.rs.
//!
//! `on_message` hands callers the raw received bytes rather than a decoded
//! `ChatWireMessage`: `chatbot.rs` multiplexes two JSON wire protocols over
//! the same room (tc-chat's `ChatWireMessage` and tc-mistllm's LLM Network
//! protocol — see `llm_network.rs`), each with its own decoder, and only the
//! caller knows which one(s) to try.
//!
//! ## Signaling: Nostr is the current (and only meaningfully configurable)
//! transport
//!
//! mistlib's engine (`ENGINE`, a process-wide `LazyLock` in
//! `.mistlib-src/mistlib-native/src/engine.rs`) starts from
//! `Config::new_default()` (`.mistlib-src/mistlib-core/src/config.rs`),
//! whose `signaling: SignalingConfig` defaults to **Nostr mode**
//! (`SignalingConfig::default() == SignalingConfig::nostr()`, in
//! `.mistlib-src/mistlib-core/src/config/signaling.rs`), fetching its relay
//! list from `https://data.tik-choco.com/server/relays.json` (currently
//! `["wss://yabu.me"]`) whenever no explicit relay/relay-list-url is
//! configured.
//!
//! `mistlib::init(id, signaling_url)` (called via `join()` below when
//! `nostr_relay` is `None`) only ever writes that `signaling_url` string
//! into `config.signaling_url` (`native_l0/init.rs` `set_signaling_url`) —
//! it never touches `config.signaling.mode`. `build_signaler`
//! (`native_l0/init.rs`) reads `config.signaling_url` *only* in the
//! `SignalingMode::WebSocket` arm; in the (default) `SignalingMode::Nostr`
//! arm it reads `config.signaling.nostr` instead. Since nothing in `init()`
//! ever sets `signaling.mode` to `WebSocket`, **a plain `signaling_url`
//! argument to `init()` is inert** — the old legacy
//! `wss://rtc.tik-choco.com/signaling` constant this module used to pass was
//! silently discarded on every run; the engine always signaled over Nostr to
//! the default public relay regardless of what was passed. (An earlier e2e
//! run pointing `--signaling-url` at a local `ws://127.0.0.1:7777` "worked
//! through a local Nostr relay" for the same reason it always "worked" —
//! that URL was ignored and the run actually went out to the real public
//! relay, not the local one.)
//!
//! To genuinely point at a custom/local Nostr relay, the config must be
//! rebuilt with `signaling.mode = "nostr"` and `signaling.nostr.relays` set
//! *before* `initialize()`/`build_context` runs — which is exactly what
//! `mistlib::init_with_config(id, json)` does in one call (merges a partial
//! JSON `FlatConfig` onto the current config, validates it, then
//! initializes). `join()` below uses that path when `nostr_relay` is
//! `Some(url)`. Per `NostrSignalingConfig::validate()`
//! (`config/signaling.rs`), a *public* (non-loopback) relay additionally
//! requires overriding the default (insecure, shared) invite salt/code —
//! which this CLI doesn't expose — so `nostr_relay` only works for local
//! relays (`localhost`/`127.0.0.1`/`::1`), matching e2e's use case.

use serde_json::json;

pub struct Network {
    node_id: String,
}

impl Network {
    pub fn new(node_id: String) -> Self {
        Self { node_id }
    }

    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// Initializes mistlib, registers event handling, and joins `room_id`.
    ///
    /// `nostr_relay`: `None` uses mistlib's default Nostr signaling (fetches
    /// the relay list from `https://data.tik-choco.com/server/relays.json`).
    /// `Some(url)` overrides the relay list with that single relay (must be
    /// a local relay — see module docs) via `mistlib::init_with_config`,
    /// e.g. for e2e tests running a local Nostr relay.
    pub fn join(
        &self,
        room_id: &str,
        nostr_relay: Option<&str>,
        on_message: impl Fn(&str, &[u8]) + Send + Sync + 'static,
        on_peer_connected: impl Fn(&str) + Send + Sync + 'static,
        on_peer_disconnected: impl Fn(&str) + Send + Sync + 'static,
    ) -> Result<(), String> {
        match nostr_relay {
            None => {
                // The signaling_url argument is inert under mistlib's default
                // Nostr signaling mode (see module docs) — passed only
                // because `init()` requires a `String`.
                mistlib::init(self.node_id.clone(), String::new());
            }
            Some(relay) => {
                let config_json = json!({
                    "signaling": {
                        "mode": "nostr",
                        "nostr": { "relays": [relay] }
                    }
                })
                .to_string();
                if !mistlib::init_with_config(self.node_id.clone(), config_json.as_bytes()) {
                    return Err(format!(
                        "signaling設定が拒否されました relay={relay} \
                         (ローカルrelay [localhost/127.0.0.1/::1] を指定してください。\
                         公開relayを使うにはinviteSalt/inviteCodeのカスタム設定が別途必要です)"
                    ));
                }
            }
        }
        mistlib::register_raw_handler(move |event_type, from_id, data| match event_type {
            mistlib::EVENT_RAW => on_message(&from_id, &data),
            mistlib::EVENT_JOIN => on_peer_connected(&from_id),
            mistlib::EVENT_LEAVE => on_peer_disconnected(&from_id),
            _ => {}
        });
        mistlib::join_room(room_id.to_string());
        Ok(())
    }

    /// Broadcasts raw bytes to every peer in the room (target_id == "" is
    /// mistlib-core's broadcast sentinel — see `NodeId::BROADCAST`).
    pub fn broadcast_bytes(&self, data: &[u8]) {
        mistlib::send_message(String::new(), data, mistlib::DELIVERY_RELIABLE);
    }

    /// Sends raw bytes to a single peer.
    pub fn send_bytes(&self, to_id: &str, data: &[u8]) {
        mistlib::send_message(to_id.to_string(), data, mistlib::DELIVERY_RELIABLE);
    }

    pub fn connected_peers(&self) -> Vec<String> {
        mistlib::get_connected_nodes()
    }

    pub fn storage_add(&self, name: &str, data: &[u8]) -> Result<String, String> {
        mistlib::app::storage_add(name, data).map_err(|e| e.to_string())
    }

    pub fn storage_get(&self, cid: &str) -> Result<Vec<u8>, String> {
        mistlib::app::storage_get(cid).map_err(|e| e.to_string())
    }

    pub fn leave(&self) {
        mistlib::leave_room();
    }
}
