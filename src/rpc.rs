//! Synthetic-peer transport research, available ONLY under `test-support`.
//! The production CLI cannot call this module or start a client process.
use crate::quota::{parse_codex_rate_limits, QuotaReport};
use serde_json::{json, Value};
use std::fmt;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

const MAX_FRAME_BYTES: u64 = 1024 * 1024;
const MAX_MESSAGES: usize = 256;

#[derive(Debug, Clone, Copy)]
pub enum ProbeError {
    SpawnFailed,
    IoFailed,
    Deadline,
    InvalidFrame,
    OversizedFrame,
    UnexpectedMessage,
    UnsolicitedRequest,
    UpstreamError,
    AccountUnavailable,
    AccountChanged,
    InvalidQuota,
    MessageLimit,
}

impl fmt::Display for ProbeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::SpawnFailed => "peer_spawn_failed",
            Self::IoFailed => "peer_io_failed",
            Self::Deadline => "peer_deadline_exceeded",
            Self::InvalidFrame => "invalid_peer_frame",
            Self::OversizedFrame => "peer_frame_too_large",
            Self::UnexpectedMessage => "unexpected_peer_message",
            Self::UnsolicitedRequest => "unsolicited_peer_request",
            Self::UpstreamError => "peer_request_failed",
            Self::AccountUnavailable => "consumer_account_identity_unavailable",
            Self::AccountChanged => "account_changed_during_query",
            Self::InvalidQuota => "invalid_quota_response",
            Self::MessageLimit => "peer_message_limit_exceeded",
        })
    }
}

impl std::error::Error for ProbeError {}

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Exercise the candidate quota-only protocol against an explicitly supplied
/// synthetic test peer. This is NOT an approved live Codex launcher.
pub fn probe_with_command(
    mut command: Command,
    timeout: Duration,
) -> Result<QuotaReport, ProbeError> {
    if timeout.is_zero() || timeout > Duration::from_secs(30) {
        return Err(ProbeError::Deadline);
    }
    let deadline = Instant::now() + timeout;
    let child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| ProbeError::SpawnFailed)?;
    let mut guard = ChildGuard(child);
    let mut input = guard.0.stdin.take().ok_or(ProbeError::IoFailed)?;
    let output = guard.0.stdout.take().ok_or(ProbeError::IoFailed)?;
    let (tx, rx) = mpsc::sync_channel(8);
    let reader = std::thread::spawn(move || {
        let mut output = BufReader::new(output);
        for _ in 0..MAX_MESSAGES {
            let mut frame = Vec::new();
            let result = (&mut output)
                .take(MAX_FRAME_BYTES + 1)
                .read_until(b'\n', &mut frame);
            let parsed = match result {
                Ok(0) | Err(_) => Err(ProbeError::IoFailed),
                Ok(_) if frame.len() as u64 > MAX_FRAME_BYTES => Err(ProbeError::OversizedFrame),
                Ok(_) => {
                    serde_json::from_slice::<Value>(&frame).map_err(|_| ProbeError::InvalidFrame)
                }
            };
            let stop = parsed.is_err();
            if tx.send(parsed).is_err() || stop {
                return;
            }
        }
        let _ = tx.send(Err(ProbeError::MessageLimit));
    });
    let result = exchange(&mut input, &rx, deadline);
    drop(input);
    drop(rx);
    drop(guard); // Always terminate and reap, including timeout/error paths.
                 // A synthetic peer may leave a descendant holding its stdout. Never let
                 // cleanup invalidate the deadline. A blocked reader is detached; there is
                 // no live launcher or long-running service using this test-only transport.
    if reader.is_finished() {
        let _ = reader.join();
    }
    result
}

fn send(input: &mut ChildStdin, value: Value) -> Result<(), ProbeError> {
    serde_json::to_writer(&mut *input, &value).map_err(|_| ProbeError::IoFailed)?;
    input
        .write_all(b"\n")
        .and_then(|_| input.flush())
        .map_err(|_| ProbeError::IoFailed)
}

fn response(
    rx: &Receiver<Result<Value, ProbeError>>,
    deadline: Instant,
    id: u64,
) -> Result<Value, ProbeError> {
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(ProbeError::Deadline)?;
        let message = rx.recv_timeout(remaining).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => ProbeError::Deadline,
            mpsc::RecvTimeoutError::Disconnected => ProbeError::IoFailed,
        })??;
        let body = message.as_object().ok_or(ProbeError::InvalidFrame)?;
        if body.contains_key("method") {
            if body.contains_key("id") {
                return Err(ProbeError::UnsolicitedRequest);
            }
            let method = body
                .get("method")
                .and_then(Value::as_str)
                .ok_or(ProbeError::InvalidFrame)?;
            if matches!(method, "account/updated" | "account/login/completed") {
                return Err(ProbeError::AccountChanged);
            }
            // Unrequested notifications are not quota observations or commands.
            continue;
        }
        if body.get("id").and_then(Value::as_u64) != Some(id) {
            return Err(ProbeError::UnexpectedMessage);
        }
        if body.get("error").is_some_and(|value| !value.is_null()) {
            return Err(ProbeError::UpstreamError);
        }
        return body
            .get("result")
            .cloned()
            .filter(Value::is_object)
            .ok_or(ProbeError::InvalidFrame);
    }
}

fn exchange(
    input: &mut ChildStdin,
    rx: &Receiver<Result<Value, ProbeError>>,
    deadline: Instant,
) -> Result<QuotaReport, ProbeError> {
    send(
        input,
        json!({"id":1,"method":"initialize","params":{
            "clientInfo":{"name":"ai-quota-preflight","version":env!("CARGO_PKG_VERSION")},
            "capabilities":{"experimentalApi":false}
        }}),
    )?;
    response(rx, deadline, 1)?;
    send(input, json!({"method":"initialized"}))?;
    send(
        input,
        json!({"id":2,"method":"account/read","params":{"refreshToken":false}}),
    )?;
    let before = identity(&response(rx, deadline, 2)?)?;
    send(input, json!({"id":3,"method":"account/rateLimits/read"}))?;
    let quota = response(rx, deadline, 3)?;
    send(
        input,
        json!({"id":4,"method":"account/read","params":{"refreshToken":false}}),
    )?;
    let after = identity(&response(rx, deadline, 4)?)?;
    if before != after {
        return Err(ProbeError::AccountChanged);
    }
    match quota.get("accountId") {
        None | Some(Value::Null) => {}
        Some(Value::String(id)) if valid_identity_field(id) => {
            if id != &before.workspace_id {
                return Err(ProbeError::AccountChanged);
            }
        }
        Some(_) => return Err(ProbeError::InvalidQuota),
    }
    parse_codex_rate_limits(&quota).map_err(|_| ProbeError::InvalidQuota)
}

// Account details live only in memory for race detection, never report or error text.
#[derive(PartialEq, Eq)]
struct AccountIdentity {
    workspace_id: String,
    email: Option<String>,
    plan_type: Option<String>,
}

fn valid_identity_field(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}

fn identity(body: &Value) -> Result<AccountIdentity, ProbeError> {
    let account = body
        .get("account")
        .and_then(Value::as_object)
        .ok_or(ProbeError::AccountUnavailable)?;
    if account.get("type").and_then(Value::as_str) != Some("chatgpt") {
        return Err(ProbeError::AccountUnavailable);
    }
    let workspace_id = body
        .pointer("/workspaceRouting/chatgptAccountId")
        .and_then(Value::as_str)
        .filter(|value| valid_identity_field(value))
        .ok_or(ProbeError::AccountUnavailable)?
        .to_owned();
    let mut metadata = Vec::new();
    for key in ["email", "planType"] {
        let field = match account.get(key) {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) if valid_identity_field(value) => Some(value.clone()),
            _ => return Err(ProbeError::AccountUnavailable),
        };
        metadata.push(field);
    }
    Ok(AccountIdentity {
        workspace_id,
        email: metadata.remove(0),
        plan_type: metadata.remove(0),
    })
}
