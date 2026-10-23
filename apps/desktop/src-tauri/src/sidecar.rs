//! Lifecycle of the orchestrator sidecar and the JSON-RPC relay between the
//! WebView, this shell and the orchestrator.
//!
//! The WebView can reach the orchestrator only through `orchestrator_call`,
//! which always stamps requests with `origin: "ui"`. The orchestrator decides
//! per method which origins are allowed (packages/contracts/src/methods.ts).
//! Requests in the other direction (orchestrator to shell) are limited to the
//! DPAPI vault and are never reachable from the WebView.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{Mutex, oneshot};

use crate::vault;

/// Tauri event carrying orchestrator events to the WebView.
pub const EVENT_CHANNEL: &str = "orchestrator-event";
/// Tauri event carrying the sidecar process state to the WebView.
pub const STATUS_CHANNEL: &str = "orchestrator-status";

const SIDECAR: &str = "btcortex-orchestrator";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TIMEOUT: Duration = Duration::from_secs(300);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// Restarts allowed in quick succession before giving up.
const MAX_RESTARTS: u32 = 3;
/// A run longer than this resets the restart counter.
const STABLE_RUN: Duration = Duration::from_secs(60);
const MAX_METHOD_NAME_LENGTH: usize = 128;

// JSON-RPC error codes, mirrored from packages/contracts/src/jsonrpc.ts.
const RPC_METHOD_NOT_FOUND: i64 = -32601;
const RPC_INVALID_PARAMS: i64 = -32602;
const RPC_INTERNAL: i64 = -32603;
const RPC_APPLICATION: i64 = -32000;
const RPC_TIMEOUT: i64 = -32002;
const RPC_UNAVAILABLE: i64 = -32004;

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self::new(RPC_UNAVAILABLE, message)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>;

pub struct Orchestrator {
    child: Mutex<Option<CommandChild>>,
    pending: Mutex<PendingMap>,
    next_id: AtomicU64,
    stopping: AtomicBool,
    restarts: AtomicU32,
    started_at: StdMutex<Option<Instant>>,
    status: StdMutex<Status>,
}

impl Orchestrator {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            stopping: AtomicBool::new(false),
            restarts: AtomicU32::new(0),
            started_at: StdMutex::new(None),
            status: StdMutex::new(Status {
                state: "starting",
                detail: None,
            }),
        })
    }

    pub fn status(&self) -> Status {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(Status {
                state: "failed",
                detail: None,
            })
    }

    fn set_status(&self, app: &AppHandle, state: &'static str, detail: Option<String>) {
        let status = Status { state, detail };
        if let Ok(mut current) = self.status.lock() {
            *current = status.clone();
        }
        if let Err(error) = app.emit(STATUS_CHANNEL, status) {
            log::warn!("Could not publish the orchestrator status: {error}");
        }
    }

    /// Runs the sidecar, restarting it with back-off after unexpected exits,
    /// until the application stops or the restart budget is exhausted.
    pub async fn supervise(self: Arc<Self>, app: AppHandle) {
        loop {
            let Some(code) = self.run_once(&app).await else {
                return;
            };
            let code = code.map_or_else(|| "unknown".to_string(), |code| code.to_string());
            for (_, waiter) in self.pending.lock().await.drain() {
                let _ = waiter.send(Err(RpcError::unavailable(
                    "The orchestrator stopped before answering.",
                )));
            }
            if self.stopping.load(Ordering::SeqCst) {
                log::info!("Orchestrator stopped (exit code {code})");
                self.set_status(&app, "stopped", None);
                return;
            }

            let ran_for = self
                .started_at
                .lock()
                .ok()
                .and_then(|started| started.map(|instant| instant.elapsed()));
            if ran_for.is_some_and(|duration| duration > STABLE_RUN) {
                self.restarts.store(0, Ordering::SeqCst);
            }
            let attempt = self.restarts.fetch_add(1, Ordering::SeqCst) + 1;
            log::error!("Orchestrator exited unexpectedly (exit code {code}, attempt {attempt})");
            if attempt > MAX_RESTARTS {
                self.set_status(
                    &app,
                    "failed",
                    Some(format!(
                        "The BTCortex orchestrator stopped repeatedly (last exit code {code}). Restart BTCortex; the logs folder contains details."
                    )),
                );
                return;
            }
            self.set_status(
                &app,
                "restarting",
                Some(format!(
                    "Restarting the orchestrator (attempt {attempt} of {MAX_RESTARTS})."
                )),
            );
            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
        }
    }

    /// Spawns the sidecar and relays its output until it terminates. Returns
    /// the exit code (`Some(None)` when unknown), or `None` if it never started.
    async fn run_once(&self, app: &AppHandle) -> Option<Option<i32>> {
        self.set_status(app, "starting", None);
        let mut command = match app.shell().sidecar(SIDECAR) {
            Ok(command) => command,
            Err(error) => {
                log::error!("The orchestrator executable is missing: {error}");
                self.set_status(
                    app,
                    "failed",
                    Some(
                        "The BTCortex orchestrator executable is missing. Reinstall BTCortex."
                            .into(),
                    ),
                );
                return None;
            }
        };
        if cfg!(debug_assertions) {
            command = command.env("BTCORTEX_DEVELOPMENT", "1");
        }
        let (mut events, child) = match command.spawn() {
            Ok(spawned) => spawned,
            Err(error) => {
                log::error!("Could not start the orchestrator: {error}");
                self.set_status(
                    app,
                    "failed",
                    Some(format!(
                        "The BTCortex orchestrator could not start: {error}"
                    )),
                );
                return None;
            }
        };
        log::info!("Orchestrator started with process id {}", child.pid());
        *self.child.lock().await = Some(child);
        if let Ok(mut started_at) = self.started_at.lock() {
            *started_at = Some(Instant::now());
        }
        self.set_status(app, "running", None);

        let mut exit_code = None;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => self.handle_line(app, &bytes).await,
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    // Development builds mirror the orchestrator log to stderr; in release
                    // builds anything on stderr is unexpected and worth a warning.
                    if cfg!(debug_assertions) {
                        log::debug!(target: "orchestrator", "{}", line.trim_end());
                    } else {
                        log::warn!(target: "orchestrator", "{}", line.trim_end());
                    }
                }
                CommandEvent::Error(error) => log::error!("Orchestrator output error: {error}"),
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                    break;
                }
                _ => {}
            }
        }
        self.child.lock().await.take();
        Some(exit_code)
    }

    async fn handle_line(&self, app: &AppHandle, bytes: &[u8]) {
        let text = String::from_utf8_lossy(bytes);
        let line = text.trim();
        if line.is_empty() {
            return;
        }
        let message: Value = match serde_json::from_str(line) {
            Ok(message) => message,
            Err(_) => {
                log::warn!(target: "orchestrator", "Ignored output that is not JSON-RPC: {}", truncate(line, 200));
                return;
            }
        };
        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").filter(|id| !id.is_null());
        match (method, id) {
            (Some(method), Some(id)) => self.serve(method, message.get("params"), id.clone()).await,
            (Some("event"), None) => {
                if let Some(params) = message.get("params")
                    && let Err(error) = app.emit(EVENT_CHANNEL, params.clone())
                {
                    log::warn!("Could not relay an orchestrator event: {error}");
                }
            }
            (Some(other), None) => log::debug!("Ignored orchestrator notification {other}"),
            (None, Some(id)) => self.settle(id, &message).await,
            (None, None) => {
                log::warn!(target: "orchestrator", "Ignored a message without method or id")
            }
        }
    }

    async fn settle(&self, id: &Value, message: &Value) {
        let Some(id) = id.as_u64() else {
            log::warn!("Ignored a response with a foreign id");
            return;
        };
        let Some(waiter) = self.pending.lock().await.remove(&id) else {
            log::warn!("Ignored a response to an unknown or expired request ({id})");
            return;
        };
        let outcome = match message.get("error") {
            Some(error) => Err(RpcError {
                code: error
                    .get("code")
                    .and_then(Value::as_i64)
                    .unwrap_or(RPC_INTERNAL),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Unknown error")
                    .to_string(),
                data: error.get("data").cloned(),
            }),
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = waiter.send(outcome);
    }

    /// Serves a request the orchestrator sent to the shell.
    async fn serve(&self, method: &str, params: Option<&Value>, id: Value) {
        let outcome = match method {
            "vault.protect" => match params
                .and_then(|p| p.get("plaintext"))
                .and_then(Value::as_str)
            {
                Some(plaintext) => vault::protect_text(plaintext)
                    .map(|blob| json!({ "protected": BASE64.encode(blob) }))
                    .map_err(|error| RpcError::new(RPC_APPLICATION, error.to_string())),
                None => Err(RpcError::new(
                    RPC_INVALID_PARAMS,
                    "Expected a plaintext string.",
                )),
            },
            "vault.unprotect" => match params
                .and_then(|p| p.get("protected"))
                .and_then(Value::as_str)
            {
                Some(encoded) => match BASE64.decode(encoded) {
                    Ok(blob) => vault::unprotect_text(&blob)
                        .map(|plaintext| json!({ "plaintext": plaintext }))
                        .map_err(|error| RpcError::new(RPC_APPLICATION, error.to_string())),
                    Err(_) => Err(RpcError::new(
                        RPC_INVALID_PARAMS,
                        "The protected value is not valid base64.",
                    )),
                },
                None => Err(RpcError::new(
                    RPC_INVALID_PARAMS,
                    "Expected a protected value.",
                )),
            },
            _ => Err(RpcError::new(
                RPC_METHOD_NOT_FOUND,
                format!("The shell does not provide \"{method}\"."),
            )),
        };
        let response = match outcome {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
        };
        if let Err(error) = self.write(&response).await {
            log::error!("Could not answer the orchestrator: {}", error.message);
        }
    }

    async fn write(&self, message: &Value) -> Result<(), RpcError> {
        let mut line = serde_json::to_vec(message)
            .map_err(|error| RpcError::new(RPC_INTERNAL, error.to_string()))?;
        line.push(b'\n');
        let mut guard = self.child.lock().await;
        let child = guard
            .as_mut()
            .ok_or_else(|| RpcError::unavailable("The BTCortex orchestrator is not running."))?;
        child.write(&line).map_err(|error| {
            RpcError::unavailable(format!(
                "Could not reach the BTCortex orchestrator: {error}"
            ))
        })
    }

    /// Sends a request and waits for its response.
    pub async fn call(
        &self,
        method: &str,
        params: Option<Value>,
        origin: &str,
        timeout: Duration,
    ) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);

        let mut request = json!({ "jsonrpc": "2.0", "id": id, "method": method, "origin": origin });
        if let Some(params) = params {
            request["params"] = params;
        }
        if let Err(error) = self.write(&request).await {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }

        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(RpcError::unavailable(
                "The orchestrator stopped before answering.",
            )),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(RpcError::new(
                    RPC_TIMEOUT,
                    format!("The orchestrator did not answer \"{method}\" in time."),
                ))
            }
        }
    }

    /// Stops the orchestrator gracefully, killing it only after the grace period.
    pub async fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if self.child.lock().await.is_none() {
            return;
        }
        if let Err(error) = self
            .call(
                "system.shutdown",
                Some(json!({ "reason": "application-exit" })),
                "shell",
                SHUTDOWN_TIMEOUT,
            )
            .await
        {
            log::warn!(
                "The orchestrator did not acknowledge the shutdown request: {}",
                error.message
            );
        }
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        while Instant::now() < deadline {
            if self.child.lock().await.is_none() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if let Some(child) = self.child.lock().await.take() {
            log::warn!("The orchestrator did not exit in time and was terminated");
            let _ = child.kill();
        }
    }
}

fn truncate(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => format!("{}…", &text[..index]),
        None => text.to_string(),
    }
}

/// Accepts dotted identifiers such as `system.getInfo`.
fn is_valid_method_name(name: &str) -> bool {
    name.len() <= MAX_METHOD_NAME_LENGTH
        && name.split('.').count() >= 2
        && name.split('.').all(|segment| {
            segment
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic())
                && segment
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
}

#[tauri::command]
pub async fn orchestrator_call(
    state: tauri::State<'_, Arc<Orchestrator>>,
    method: String,
    params: Option<Value>,
    timeout_ms: Option<u64>,
) -> Result<Value, RpcError> {
    if !is_valid_method_name(&method) {
        return Err(RpcError::new(
            RPC_METHOD_NOT_FOUND,
            "The method name is not valid.",
        ));
    }
    let timeout = timeout_ms
        .map_or(DEFAULT_TIMEOUT, Duration::from_millis)
        .min(MAX_TIMEOUT);
    state.call(&method, params, "ui", timeout).await
}

#[tauri::command]
pub fn orchestrator_status(state: tauri::State<'_, Arc<Orchestrator>>) -> Status {
    state.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_method_names() {
        assert!(is_valid_method_name("system.getInfo"));
        assert!(is_valid_method_name("bitcoinCore.nodes.list"));
        assert!(!is_valid_method_name("system"));
        assert!(!is_valid_method_name("system..ping"));
        assert!(!is_valid_method_name("system.ping;rm"));
        assert!(!is_valid_method_name("1system.ping"));
        assert!(!is_valid_method_name(&format!(
            "a.{}",
            "b".repeat(MAX_METHOD_NAME_LENGTH)
        )));
    }

    #[test]
    fn truncates_on_character_boundaries() {
        assert_eq!(truncate("£££", 2), "££…");
        assert_eq!(truncate("short", 10), "short");
    }
}
