//! CLI entry point.
//!
//!   tc-chat identity
//!   tc-chat run --room my-room
//!   tc-chat send --room my-room --text "hello"
//!   tc-chat chat --room my-room

use clap::{Parser, Subcommand};
use tc_chat_cli::chatbot::{BotConfig, LlmBackend, TriggerMode, DEFAULT_SYSTEM_PROMPT};
use tc_chat_cli::identity::{default_identity_path, ensure_identity};
use tc_chat_cli::llm::OpenAIConfig;
use tc_chat_cli::{bot, chatbot, store::RoomStore};

const DEFAULT_LLM_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Parser)]
#[command(name = "tc-chat", about = "tc-chat resident archive bot CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// ルームに常駐し、受信メッセージを署名検証のうえ保管し、新規参加ピアへ履歴を再送する
    Run {
        #[arg(long)]
        room: String,
        /// 既定ではmistlibの標準Nostrシグナリング（relay listは
        /// https://data.tik-choco.com/server/relays.json から取得）を使う。
        /// ローカルのNostr relay（例: e2eテスト用）を明示的に使いたい場合のみ
        /// ws(s)://のrelay URL（localhost/127.0.0.1/::1限定）を指定する
        #[arg(long)]
        signaling_url: Option<String>,
    },
    /// ローカルDID identityを表示する（未生成なら新規生成して保存する）
    Identity,
    /// 動作確認用: 署名付きテキストメッセージをルームへ送信する
    Send {
        #[arg(long)]
        room: String,
        #[arg(long)]
        text: String,
        #[arg(long, default_value = "tc-chat-cli")]
        name: String,
        /// 既定ではmistlibの標準Nostrシグナリング（relay listは
        /// https://data.tik-choco.com/server/relays.json から取得）を使う。
        /// ローカルのNostr relay（例: e2eテスト用）を明示的に使いたい場合のみ
        /// ws(s)://のrelay URL（localhost/127.0.0.1/::1限定）を指定する
        #[arg(long)]
        signaling_url: Option<String>,
        /// mistlibが接続を確立してから送信・終了するまでの待機秒数
        #[arg(long, default_value_t = 3)]
        wait_secs: u64,
    },
    /// ルームに参加し、対話的にチャットする（標準入力から送信、受信は署名検証のうえ表示・保管する）
    Chat {
        #[arg(long)]
        room: String,
        #[arg(long, default_value = "tc-chat-cli")]
        name: String,
        /// 既定ではmistlibの標準Nostrシグナリング（relay listは
        /// https://data.tik-choco.com/server/relays.json から取得）を使う。
        /// ローカルのNostr relay（例: e2eテスト用）を明示的に使いたい場合のみ
        /// ws(s)://のrelay URL（localhost/127.0.0.1/::1限定）を指定する
        #[arg(long)]
        signaling_url: Option<String>,
    },
    /// ルームに常駐し、LLM(OpenAI互換API)で応答するAI参加者として振る舞う。
    /// runモードと同様にメッセージの保存・履歴再送も行う
    Bot {
        #[arg(long)]
        room: String,
        #[arg(long, default_value = "tc-bot")]
        name: String,
        /// 既定ではmistlibの標準Nostrシグナリング（relay listは
        /// https://data.tik-choco.com/server/relays.json から取得）を使う。
        /// ローカルのNostr relay（例: e2eテスト用）を明示的に使いたい場合のみ
        /// ws(s)://のrelay URL（localhost/127.0.0.1/::1限定）を指定する
        #[arg(long)]
        signaling_url: Option<String>,
        /// LLMバックエンド: api（OpenAI互換HTTP直接呼び出し、既定）またはnetwork（同じルームに参加した
        /// tc-mistllm provider / tc-translateのproviderモードへmistネットワーク越しに転送）
        #[arg(long, default_value = "api")]
        llm: String,
        /// LLM APIのベースURL（--llm apiのみ。省略時は環境変数TC_CHAT_LLM_BASE_URLか既定値を使用）
        #[arg(long)]
        base_url: Option<String>,
        /// LLM APIキー（--llm apiのみ。省略時は環境変数TC_CHAT_LLM_API_KEYを使用。--llm networkと同時指定はエラー）
        #[arg(long)]
        api_key: Option<String>,
        /// LLMモデル名（--llm apiでは必須、--llm networkでは省略可能なpassthrough。省略時は環境変数TC_CHAT_LLM_MODELを使用）
        #[arg(long)]
        model: Option<String>,
        /// --llm networkでのprovider応答タイムアウト秒数
        #[arg(long, default_value_t = 60.0)]
        llm_timeout_secs: f64,
        /// システムプロンプト（直接指定）
        #[arg(long)]
        system_prompt: Option<String>,
        /// システムプロンプトをファイルから読み込む（--system-promptと同時指定時はこちらを優先）
        #[arg(long)]
        system_prompt_file: Option<std::path::PathBuf>,
        /// 返信トリガー: all（全メッセージに返信）またはmention（ボット名/@ボット名を含む場合のみ返信）
        #[arg(long, default_value = "mention")]
        trigger: String,
        /// LLMへ渡す直近メッセージ履歴の保持件数
        #[arg(long, default_value_t = 20)]
        history: usize,
    },
}

fn base_dir() -> std::path::PathBuf {
    let home = std::env::var_os("HOME").expect("HOME environment variable is not set");
    std::path::PathBuf::from(home).join(".tc-chat-cli")
}

fn main() {
    let cli = Cli::parse();
    let identity_path = default_identity_path().expect("failed to resolve identity path");

    let code = match cli.command {
        Command::Identity => {
            match ensure_identity(&identity_path) {
                Ok(identity) => {
                    println!("did: {}", identity.did);
                    println!("keyType: {}", identity.key_type);
                    println!("publicKeyMultibase: {}", identity.public_key_multibase);
                    println!("createdAt: {}", identity.created_at);
                    println!("identityPath: {}", identity_path.display());
                    0
                }
                Err(err) => {
                    eprintln!("エラー: identityの読み込み/生成に失敗しました: {err}");
                    1
                }
            }
        }
        Command::Run { room, signaling_url } => {
            // Touches the store up front so a bad --room / permission issue
            // fails fast instead of after mistlib has already joined.
            if let Err(err) = RoomStore::open(&base_dir(), &room) {
                eprintln!("エラー: ルームストレージの初期化に失敗しました: {err}");
                std::process::exit(1);
            }
            match bot::run(&base_dir(), &room, signaling_url.as_deref()) {
                Ok(()) => 0,
                Err(err) => {
                    eprintln!("エラー: {err}");
                    1
                }
            }
        }
        Command::Send { room, text, name, signaling_url, wait_secs } => {
            let identity = match ensure_identity(&identity_path) {
                Ok(identity) => identity,
                Err(err) => {
                    eprintln!("エラー: identityの読み込み/生成に失敗しました: {err}");
                    std::process::exit(1);
                }
            };
            match bot::send_text(&identity, &name, &room, &text, signaling_url.as_deref(), wait_secs) {
                Ok(()) => 0,
                Err(err) => {
                    eprintln!("エラー: {err}");
                    1
                }
            }
        }
        Command::Chat { room, name, signaling_url } => {
            let identity = match ensure_identity(&identity_path) {
                Ok(identity) => identity,
                Err(err) => {
                    eprintln!("エラー: identityの読み込み/生成に失敗しました: {err}");
                    std::process::exit(1);
                }
            };
            match bot::chat(&base_dir(), &identity, &name, &room, signaling_url.as_deref()) {
                Ok(()) => 0,
                Err(err) => {
                    eprintln!("エラー: {err}");
                    1
                }
            }
        }
        Command::Bot {
            room,
            name,
            signaling_url,
            llm,
            base_url,
            api_key,
            model,
            llm_timeout_secs,
            system_prompt,
            system_prompt_file,
            trigger,
            history,
        } => {
            let identity = match ensure_identity(&identity_path) {
                Ok(identity) => identity,
                Err(err) => {
                    eprintln!("エラー: identityの読み込み/生成に失敗しました: {err}");
                    std::process::exit(1);
                }
            };
            if let Err(err) = RoomStore::open(&base_dir(), &room) {
                eprintln!("エラー: ルームストレージの初期化に失敗しました: {err}");
                std::process::exit(1);
            }

            let trigger = match TriggerMode::parse(&trigger) {
                Ok(trigger) => trigger,
                Err(err) => {
                    eprintln!("エラー: {err}");
                    std::process::exit(1);
                }
            };

            let backend = match llm.as_str() {
                "api" => {
                    let base_url = base_url
                        .or_else(|| std::env::var("TC_CHAT_LLM_BASE_URL").ok())
                        .unwrap_or_else(|| DEFAULT_LLM_BASE_URL.to_string());
                    let api_key = api_key.or_else(|| std::env::var("TC_CHAT_LLM_API_KEY").ok()).unwrap_or_default();
                    let model = match model.or_else(|| std::env::var("TC_CHAT_LLM_MODEL").ok()) {
                        Some(model) => model,
                        None => {
                            eprintln!("エラー: --llm apiでは--modelまたは環境変数TC_CHAT_LLM_MODELでLLMモデル名を指定してください");
                            std::process::exit(1);
                        }
                    };
                    LlmBackend::Api(OpenAIConfig { base_url, api_key, model })
                }
                "network" => {
                    if api_key.is_some() {
                        eprintln!("エラー: --llm networkと--api-keyは同時に指定できません（providerが自分のAPIキーで応答するため不要です）");
                        std::process::exit(1);
                    }
                    if base_url.is_some() {
                        eprintln!("エラー: --llm networkと--base-urlは同時に指定できません（LLM APIには直接接続しません）");
                        std::process::exit(1);
                    }
                    LlmBackend::Network { model, timeout: std::time::Duration::from_secs_f64(llm_timeout_secs) }
                }
                other => {
                    eprintln!("エラー: 不明な--llmバックエンドです: {other} (api|networkのいずれかを指定してください)");
                    std::process::exit(1);
                }
            };

            let system_prompt = match system_prompt_file {
                Some(path) => match std::fs::read_to_string(&path) {
                    Ok(contents) => contents,
                    Err(err) => {
                        eprintln!("エラー: system-prompt-fileの読み込みに失敗しました: {err}");
                        std::process::exit(1);
                    }
                },
                None => system_prompt.unwrap_or_else(|| DEFAULT_SYSTEM_PROMPT.to_string()),
            };

            let config = BotConfig { bot_name: name, system_prompt, trigger, history_capacity: history, backend };

            match chatbot::run(&base_dir(), &identity, &room, signaling_url.as_deref(), config) {
                Ok(()) => 0,
                Err(err) => {
                    eprintln!("エラー: {err}");
                    1
                }
            }
        }
    };
    std::process::exit(code);
}
