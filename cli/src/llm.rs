//! Minimal OpenAI-compatible chat completions client (reqwest, blocking).
//! Adapted from tc-mistllm/cli/src/openai_client.rs, trimmed to a single
//! non-streaming call since `chatbot.rs` sends the LLM's full reply as one
//! signed text message rather than streaming deltas into the room.

use std::fmt;

use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct OpenAIConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug)]
pub struct OpenAIError(pub String);

impl fmt::Display for OpenAIError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for OpenAIError {}

/// POSTs {base_url}/chat/completions with the given messages (non-streaming)
/// and returns the assembled reply content.
pub fn call_openai(
    client: &reqwest::blocking::Client,
    config: &OpenAIConfig,
    messages: &[ChatMessage],
) -> Result<String, OpenAIError> {
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = json!({
        "model": config.model,
        "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
        "stream": false,
    });

    let response = client
        .post(&url)
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .map_err(|err| OpenAIError(format!("LLM APIへのリクエストに失敗しました: {err}")))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().unwrap_or_default();
        let truncated: String = text.chars().take(500).collect();
        return Err(OpenAIError(format!("LLM APIがエラーを返しました ({status}): {truncated}")));
    }

    let parsed: Value = response
        .json()
        .map_err(|_| OpenAIError("LLM APIから予期しない形式のレスポンスが返されました".to_string()))?;
    parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| OpenAIError("LLM APIから予期しない形式のレスポンスが返されました".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    fn mock_server(respond: impl FnOnce(&str, &str) -> Vec<u8> + Send + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handle_one(stream, respond);
        });
        format!("http://{addr}")
    }

    fn handle_one(mut stream: TcpStream, respond: impl FnOnce(&str, &str) -> Vec<u8>) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut request_line = String::new();
        reader.read_line(&mut request_line).unwrap();

        let mut content_length = 0usize;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                break;
            }
            if let Some(rest) = trimmed.to_ascii_lowercase().strip_prefix("content-length:") {
                content_length = rest.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            reader.read_exact(&mut body).unwrap();
        }
        let body_text = String::from_utf8_lossy(&body).to_string();

        let raw_response = respond(request_line.trim_end(), &body_text);
        stream.write_all(&raw_response).unwrap();
    }

    fn config(base_url: String) -> OpenAIConfig {
        OpenAIConfig { base_url, api_key: "sk-test".to_string(), model: "gpt-4o".to_string() }
    }

    fn messages() -> Vec<ChatMessage> {
        vec![ChatMessage { role: "user".to_string(), content: "hello".to_string() }]
    }

    #[test]
    fn sends_correct_request_and_parses_response() {
        let base_url = mock_server(|request_line, body| {
            assert!(request_line.starts_with("POST /chat/completions"));
            assert!(body.contains("\"model\":\"gpt-4o\""));
            let payload = b"{\"choices\":[{\"message\":{\"content\":\"hi there\"}}]}";
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                payload.len()
            )
            .into_bytes()
            .into_iter()
            .chain(payload.iter().copied())
            .collect()
        });

        let client = reqwest::blocking::Client::new();
        let result = call_openai(&client, &config(base_url), &messages()).unwrap();
        assert_eq!(result, "hi there");
    }

    #[test]
    fn raises_clear_error_on_http_error() {
        let base_url = mock_server(|_line, _body| {
            let body = b"unauthorized";
            format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n",
                body.len()
            )
            .into_bytes()
            .into_iter()
            .chain(body.iter().copied())
            .collect()
        });

        let client = reqwest::blocking::Client::new();
        let err = call_openai(&client, &config(base_url), &messages()).unwrap_err();
        assert!(err.0.contains("401"), "unexpected message: {}", err.0);
    }

    #[test]
    fn raises_clear_error_when_connection_fails() {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_millis(500))
            .build()
            .unwrap();
        let config = config("http://127.0.0.1:1".to_string());
        let err = call_openai(&client, &config, &messages()).unwrap_err();
        assert!(err.0.contains("リクエストに失敗しました"), "unexpected message: {}", err.0);
    }

    #[test]
    fn raises_when_json_response_has_no_content() {
        let base_url = mock_server(|_line, _body| {
            let payload = b"{\"choices\":[{}]}";
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                payload.len()
            )
            .into_bytes()
            .into_iter()
            .chain(payload.iter().copied())
            .collect()
        });

        let client = reqwest::blocking::Client::new();
        let err = call_openai(&client, &config(base_url), &messages()).unwrap_err();
        assert!(err.0.contains("予期しない形式"), "unexpected message: {}", err.0);
    }
}
