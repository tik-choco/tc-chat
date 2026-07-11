# tc-chat 常駐アーカイブbot CLI (Rust)

mistlib-native（rlibとして直接リンク、FFI不要）を使った、tc-chatの部屋に常駐するRust製ボットです。Web版（`../src`）と同一のワイヤプロトコル・署名方式で動作し、Webクライアントが誰もいない間もメッセージとCID本文をローカルに保管して、後から参加したピアへ提供します。

- **runモード**: ルームに参加し、受信した`tc-chat:message`ワイヤを署名検証したうえで`~/.tc-chat-cli/rooms/<roomId>/messages.jsonl`に保存し、CID本文を`~/.tc-chat-cli/rooms/<roomId>/cids/`に保存します。新しいピアが参加すると、保管済みの全メッセージ（元の署名を保持したまま）をそのピアへ再送します。
- **identityモード**: ローカルのdid:key identityを表示します（初回は生成して保存します）。
- **sendモード**: 動作確認用に、署名付きテキストメッセージをルームへ送信します。
- **chatモード**: ルームに参加し、標準入力から対話的にチャットできます。送信は`send`と同じ経路（storage_add→署名→broadcast）、受信は`run`と同じ経路（署名検証→アーカイブ→CID保存）を共有し、検証済みメッセージを`[<短縮did>] <fromName> ✓: <本文>`の形式で表示します。

## セットアップ

`cli/Cargo.toml`の`mistlib`依存は相対パス`cli/.mistlib-src/mistlib-native`を参照しています。`.mistlib-src`はgitignore対象なので、初回ビルド前にfetchスクリプトでmistlibのソースを取得してください（Web版の`scripts/fetch-mistlib.mjs`と同じ`.env`を共有します）。

```bash
# リポジトリルート（tc-chat/）で一度だけ
cp .env.example .env
# .env に MISTLIB_REPO（mistlib-devのgit URL）/ MISTLIB_REF を設定

cd cli
node scripts/fetch-mistlib.mjs   # cli/.mistlib-src にmistlibソースをclone/更新
cargo build --release
```

### シグナリングについて

すべてのサブコマンド（`run`/`send`/`chat`/`bot`）は既定でmistlibの標準Nostrシグナリングを使います。relay listは`https://data.tik-choco.com/server/relays.json`から取得され、現在は`["wss://yabu.me"]`です（旧`wss://rtc.tik-choco.com/signaling`のWebSocketシグナリングはmistlibのデフォルト設定では既に使われていません）。

`--signaling-url`はもはや「シグナリングサーバーのURL」ではなく、**ローカルのNostr relayを明示的に使いたい場合のオーバーライド**です（例: e2eテストで立てたローカルrelay）。`localhost`/`127.0.0.1`/`::1`のrelayのみ受け付けます（公開relayをこの経路で使うには、mistlib側のデフォルトの招待salt/codeとは別の設定が必要で、本CLIはそれを公開していません）。

```bash
cargo run --release -- run --room my-room-01 --signaling-url ws://127.0.0.1:7777
```

## 使い方

### identity（DID identityの確認・初回生成）

```bash
cd tc-chat/cli
cargo run -- identity
```

`~/.tc-chat-cli/identity.json`にdid:key Ed25519 identityを生成・保存します。スキーマはtc-storage/tc-chatのlocalStorage identityと同一です（`did`, `method`, `keyType`, `publicKeyMultibase`, `privateKeyPkcs8`, `createdAt`）。

### run（常駐ボット）

```bash
cd tc-chat/cli
cargo run --release -- run --room my-room-01
```

ルームに参加し、受信メッセージを検証・保管しつつ常駐します（Ctrl+Cで終了）。

### send（送信確認用）

```bash
cd tc-chat/cli
cargo run --release -- send --room my-room-01 --text "こんにちは" --name "cli-bot"
```

### chat（対話モード）

```bash
cd tc-chat/cli
cargo run --release -- chat --room my-room-01 --name "cli-user"
```

行を入力してEnterで送信します。受信メッセージは署名検証されたものだけが以下の形式で表示されます（未検証のメッセージは`run`同様に破棄され、表示も保存もされません）。

```
[did:key:z6Mk…H1e2X8] 相手の名前 ✓: こんにちは
```

参加中は`run`と同じ`RoomStore`にメッセージ・CID本文を保管し、新しいピアが参加すると`run`と同じ`archive::replay_history_to`で履歴を再送します（`src/archive.rs`に共通化）。`p2p`（`../../p2p/src/app/chat.rs`）のraw-modeなTUIチャットとは異なり、`crossterm`等に依存しない素朴な行入力（`stdin().lines()`）方式なので、ターミナル自身の行編集（矢印キー・Backspace等）はそのまま使えますが、入力途中に受信メッセージが届くと画面上の入力行が一旦崩れて再描画されます（詳細は「未解決の課題・妥協点」参照）。

### bot（LLM AI参加者）

ルームに常駐し、OpenAI互換のchat completions APIを使って受信メッセージに応答するAIボットです。`run`と同様に受信メッセージの署名検証・保存・履歴再送を行うため、アーカイブボットとしても機能します。

```bash
cd tc-chat/cli
export TC_CHAT_LLM_API_KEY="sk-..."
cargo run --release -- bot \
  --room my-room-01 \
  --name "tc-bot" \
  --model gpt-4o-mini \
  --trigger mention
```

主なオプション:

- `--room <id>` (必須): 参加するルームID
- `--name <name>` (既定: `tc-bot`): ボットの表示名。`--trigger mention`時のメンション判定にも使われる
- `--base-url` / 環境変数`TC_CHAT_LLM_BASE_URL` (既定: `https://api.openai.com/v1`): LLM APIのベースURL
- `--api-key` / 環境変数`TC_CHAT_LLM_API_KEY`: LLM APIキー
- `--model` / 環境変数`TC_CHAT_LLM_MODEL` (必須のいずれか): LLMモデル名
- `--system-prompt <text>` / `--system-prompt-file <path>`: システムプロンプト（両方省略時は日本語向けの既定ペルソナを使用）
- `--trigger all|mention` (既定: `mention`): `all`は全テキストメッセージに応答、`mention`はメッセージ本文にボット名または`@ボット名`が含まれる場合のみ応答
- `--history <n>` (既定: `20`): LLMに渡す直近の会話履歴の保持件数

受信したテキストメッセージはメモリ上のローリング履歴（`--history`件までの`(発言者, 本文)`のペア）に追加され、トリガー条件に合致すると履歴全体をコンテキストとしてLLMを呼び出し、その応答全文を`send`/`chat`と同じ経路（`storage_add`→署名→`RoomStore`保存→broadcast）で1件の署名付きテキストメッセージとしてルームへ送信します（応答をストリーミングでルームに逐次送ることはしません）。LLM呼び出しは同時に1件までとし（`Mutex`によるシリアライズ）、呼び出し中に新たなトリガーが発生した場合はそのメッセージへの返信をスキップしてログに残します（キューイングはしません）。LLM呼び出しの失敗はstderrにログを出すのみでボットは常駐を継続します。

#### `--llm network`: mist越しのLLM Networkプロバイダを使う

`--llm network`を指定すると、LLM APIへ直接HTTP接続する代わりに、**同じチャットルームに参加したproviderピア**へtc-mistllmの「LLM Network」mistプロトコル（`llm_request`/`llm_response_chunk`/`llm_response_done`/`llm_error`/`provider_hello`/`consumer_hello`、`src/llm_network.rs`）でリクエストを転送します。

```bash
cd tc-chat/cli
cargo run --release -- bot --room my-room-01 --name tc-bot --llm network --trigger mention
```

別プロセス（同じマシンでも別ホストでも可）でproviderを同じルームに参加させます。tc-mistllmの`provide`サブコマンド:

```bash
cd tc-mistllm/cli
cargo run --release -- provide --room my-room-01 --base-url https://api.openai.com/v1 --api-key sk-... --model gpt-4o-mini
```

または、tc-translate（Web）のprovider モードで同じroom idを指定して参加させても動作します。

なぜこの設計か: mistlib-native はプロセスにつき1ルームのみのグローバルシングルトンです（`.mistlib-src/mistlib-native/src/app.rs`の`join_room`/`leave_room`。同時に複数ルームへ参加する概念がありません）。そのためこのボットはLLM専用の別ルームに参加することができず、代わりに**すでに参加しているチャットルームへLLM Networkプロトコルを多重化**しています。`src/node.rs`の`on_message`は受信バイト列をまず`ChatWireMessage`としてデコードを試み（tc-chatメッセージ）、失敗したら`llm_network::decode_message`を試し（LLM Networkプロトコル）、どちらでもなければ黙って無視します。provider側はチャット参加者からは見えますが、`kind`が`text`のtc-chatメッセージを送らない限りチャット履歴には影響しません。

挙動:
- providerの発見: providerが`provider_hello`を送ってきたピアを「現在のprovider」として記録します（最新のものを優先）。ボット自身も`join`直後と新しいピアが接続する都度`consumer_hello`をブロードキャスト/ユニキャストするため、後から参加したprovider・先に参加していたproviderのどちらでもボットを発見できます（tc-translateのconsumerハンドシェイクと同様）。
- provider不在時: トリガーされた返信のたびに「ルームにLLM providerが見つかりません」というエラーをログに出し、クラッシュせずに`provider_hello`を待ち続けます。
- タイムアウト: `--llm-timeout-secs`（既定60秒）以内にprovider応答が完了しない場合、タイムアウトエラーをログに出します。
- `--model`はproviderへのpassthrough指定として使えます（省略可能。指定しない場合はprovider側の既定モデルが使われます）。
- `--base-url`・`--api-key`は`--llm network`と同時に指定するとエラーになります（LLM APIへの直接接続を行わないため不要です）。

#### 代替構成: `mistllm serve` を別プロセスで立てて `--llm api` から使う

mistネットワーク越しではなく、ローカルのOpenAI互換HTTPサーバー経由でLLM Networkのproviderを使いたい場合は、tc-mistllmの`serve`サブコマンドを別プロセスで立ち上げ、`tc-chat bot`側は通常の`--llm api`でそのローカルサーバーを指定します。

```bash
# 別プロセス: mistネットワーク越しのproviderをローカルのOpenAI互換HTTPサーバーとして公開
cd tc-mistllm/cli
cargo run --release -- serve --room my-room-01 --port 8123

# tc-chat側: 通常のapiバックエンドとしてそのローカルサーバーを指定
cd tc-chat/cli
cargo run --release -- bot --room my-room-01 --name tc-bot \
  --llm api --base-url http://127.0.0.1:8123/v1 --model default
```

この構成では`tc-chat bot`と`mistllm serve`は別々のmistルーム（あるいは`mistllm serve`側が別ルームでproviderへ中継）を使えるため、`--llm network`のようにチャットルームへプロトコルを多重化する必要がありません。

## tc-chatプロトコルとの互換ポイント

- **ワイヤ形式**: `src/hooks/useChatMessages.ts`の`ChatWireMessage`（`type: "tc-chat:message"`, `id`, `fromId`, `fromName`, `timestamp`, `kind`, `cid`, `mimeType?`, `fileName?`, `fileSize?`, `signature`）と同一のJSONシリアライズです（`src/wire.rs`）。
- **署名**: `src/crypto/didIdentity.ts`のdid:key Ed25519（multicodec `0xed01`、base58btc、PKCS8+base64秘密鍵、base64url署名）を`ed25519-dalek`で再実装しています（`src/identity.rs`）。`src/crypto/didIdentity.test.ts`と同じ固定ベクトル（32byte鍵の先頭=1・末尾=255 -> `did:key:z6MkeXATEjyXENzBXBxgC5EHk2JE5aqd7qMGGtDpLUH1e2X8`）をRust側でもテストしています。
- **stableStringify**: `src/lib/wireSign.ts`の`stableStringify`（キーをソートしたJSON文字列化）を`src/stable_json.rs`に移植しています。フィールド名はすべて既知のASCII文字列のため、TSの`localeCompare`ソートと`str::cmp`は本CLIが扱う全ペイロードでバイト一致します。
- **CID本文**: mistlibの`storage_add`/`storage_get`（コンテンツアドレス指定ストレージ）をそのまま利用し、Web版と同じ仕組みでメッセージ本文を配布します。
- **履歴の再配信**: tc-chatのワイヤプロトコルには履歴同期専用のメッセージ型が存在しません（mistlib storageはCID単位のcontent-addressableな取得のみで、「部屋の履歴をよこせ」という概念がない）。そのため本ボットは新しいメッセージ型を追加せず、`EVENT_JOIN`（ピア接続検知）時に保管済みの`ChatWireMessage`をそのまま（元の送信者の署名を保持したまま）新規ピアへユニキャスト再送する方式を採っています。署名は元の`fromId`に対するものであり中継者に依存しないため、受信側の既存の`verifyWire`＋`appendMessage`（id基準で重複排除済み）がそのまま機能し、Web版に一切変更を加える必要がありません。

## テスト

```bash
cd tc-chat/cli
cargo test
```

`identity.rs`（did:key固定ベクトル・署名検証・永続化）、`stable_json.rs`（stableStringifyのキー整列・既知ペイロード一致）、`wire.rs`（ワイヤの署名・検証・JSONラウンドトリップ・短縮did表示）、`store.rs`（JSONLの重複排除・CID保存）をユニットテストしています。`llm.rs`（OpenAI互換クライアント）はローカルの生TCPモックサーバーでリクエスト形式・レスポンス解析・エラーハンドリングをテストしています。`chatbot.rs`のtrigger判定（`should_reply`）・ローリング履歴（`History`）・プロンプト構築（`build_prompt`）はmistlibに依存しない純粋ロジックとして分離し、ユニットテストしています。`llm_network.rs`（LLM Networkプロトコルのエンコード/デコード、`ConsumerCore`のprovider追跡・リクエスト相関・seq順の chunk再構成・タイムアウト・provider不在エラー）は注入した`send`クロージャに対してmistlib無しでユニットテストしています。実際のmistlib接続（実シグナリング・実P2P通信）はテストしていません — `node.rs`にmistlibへの依存が隔離されており、他のモジュールのテストからは呼ばれません。`bot.rs`（run/send/chatのオーケストレーション）・`chatbot.rs::run`（botサブコマンドのオーケストレーション）・`archive.rs`（共通の検証・保存・履歴再送ロジック）も同様にmistlibの`Network`に依存するため、ユニットテストの対象外です。

## 構造

```
cli/
├── Cargo.toml
├── scripts/fetch-mistlib.mjs
└── src/
    ├── main.rs         # clap CLI dispatch（identity/run/send/chat/botサブコマンド）
    ├── lib.rs           # モジュール宣言
    ├── identity.rs       # did:key Ed25519 identity（生成・永続化・署名・検証）
    ├── base58.rs         # base58btcエンコード/デコード
    ├── stable_json.rs    # stableStringify（署名対象ペイロードの決定的直列化）
    ├── wire.rs           # ChatWireMessage（tc-chatワイヤ形式と互換）+ 短縮did表示
    ├── store.rs          # JSONLメッセージアーカイブ + CID本文の保存
    ├── archive.rs        # run/chat共通: 受信検証・保存・履歴再送
    ├── bot.rs            # run/send/chatのオーケストレーション
    ├── llm.rs            # OpenAI互換chat completionsクライアント（tc-mistllmから移植）
    ├── llm_network.rs    # LLM Networkプロトコル(エンコード/デコード)+ConsumerCore（tc-mistllmから移植・チャットルームに多重化）
    ├── chatbot.rs        # botサブコマンド: trigger判定/履歴/プロンプト構築(純粋ロジック)+オーケストレーション(api/networkバックエンド)
    └── node.rs           # mistlib-native接続の隔離層（生バイト列をon_messageへ渡し、chatbot.rsが複数プロトコルを振り分ける）
```

## 未解決の課題・妥協点

- 履歴再送はメッセージの`cid`本文（`storage_get`で取得済みのバイト列）自体は再送しません。mistlibのcontent-addressable storageはCIDさえ分かれば新規ピアが自力で`storage_get`できる設計のため、ワイヤメッセージ（メタデータ+CID）のみの再送で十分という想定です。ネットワーク的にオリジナル送信者もこのボットも参照可能なCIDプロバイダとして見えている必要があります（mistlibのstorage層が担保）。
- `send`モードは`--wait-secs`（デフォルト3秒）で接続確立とフラッシュを待ってから終了する簡易実装です。P2P接続の確立完了を確実に検知するAPIがmistlib-nativeの公開関数群には見当たらなかったため、確認用途を想定した固定待機にしています。
- `project-post`（`src/hooks/useProjectPosts.ts`）や添付ファイル（`kind: "media"/"file"`）はCLI側では未実装です。ワイヤ形式・保存の枠組みは`ChatWireMessage`と共通のため拡張は容易ですが、要件（`run`/`identity`/`send`）には含まれていません。
- tc-mistllm CLIとの統合（共通クレート化）は行っていません。`identity.rs`/`stable_json.rs`はtc-mistllmとほぼ同一のロジックになるはずなので、将来的な統合時はこれらを共通クレートへ切り出す想定です。
- `chat`モードは`crossterm`のraw modeを使わず素朴な`stdin().lines()`方式を採っています（`../../p2p`の`p2p chat`はraw mode + 専用キー入力スレッドでプロンプト行を保持したまま描画し直す方式を採用しており、より洗練されたUXですが依存が増えます）。そのため入力途中に受信メッセージが割り込むと画面上の入力行が一旦崩れて再描画される点が既知のトレードオフです（標準入力のバッファ自体は破壊されません）。
