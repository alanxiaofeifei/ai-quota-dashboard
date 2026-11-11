//! Synthetic JSONL peer for protocol tests. Never connects to a real service.
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::time::Duration;

const SECRET: &str = "SYNTHETIC_SECRET_MUST_NOT_ESCAPE";

fn emit(value: &Value) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, value)?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

fn read_message(reader: &mut impl BufRead) -> io::Result<Value> {
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "peer closed"));
    }
    serde_json::from_str(&line)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid test request"))
}

fn expect(reader: &mut impl BufRead, method: &str, id: Option<u64>) -> io::Result<Value> {
    let value = read_message(reader)?;
    assert_eq!(value.get("method").and_then(Value::as_str), Some(method));
    assert_eq!(value.get("id").and_then(Value::as_u64), id);
    assert!(value.get("jsonrpc").is_none());
    if method == "account/read" {
        assert_eq!(value.pointer("/params/refreshToken"), Some(&json!(false)));
    }
    if method == "initialize" {
        assert_ne!(
            value.pointer("/params/capabilities/experimentalApi"),
            Some(&json!(true))
        );
    }
    Ok(value)
}

fn account(id: u64, changed: bool) -> Value {
    let (account_id, email) = if changed {
        ("synthetic-account-b", "synthetic-b@example.invalid")
    } else {
        ("synthetic-account-a", "synthetic-a@example.invalid")
    };
    json!({"id": id, "result": {"account": {
        "type": "chatgpt", "accountId": account_id,
        "email": email, "planType": "plus"
    }, "requiresOpenaiAuth": true}})
}

fn main() -> io::Result<()> {
    let mut args = std::env::args().skip(1);
    let scenario = args.next().unwrap_or_else(|| "success".to_owned());
    if scenario == "hold_stdout" {
        std::thread::sleep(Duration::from_secs(1));
        return Ok(());
    }
    if scenario == "capture_stderr" {
        let mut child = std::process::Command::new(std::env::current_exe()?);
        child.arg("stderr");
        let report = ai_quota_preflight::rpc::probe_with_command(child, Duration::from_secs(2))
            .expect("synthetic stderr scenario should succeed");
        emit(&serde_json::to_value(report)?)?;
        return Ok(());
    }
    // Tests can observe cleanup using a synthetic PID, without exposing any account data.
    if let Some(pid_path) = args.next() {
        std::fs::write(pid_path, std::process::id().to_string())?;
    }
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    expect(&mut reader, "initialize", Some(1))?;
    if scenario == "descendant_stdout" {
        // A bounded synthetic descendant keeps the pipe open after this peer dies.
        // It exits on its own after one second; no real service or account is involved.
        let mut descendant = std::process::Command::new(std::env::current_exe()?)
            .arg("hold_stdout")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        std::thread::spawn(move || {
            let _ = descendant.wait();
        });
    }

    match scenario.as_str() {
        "hang" => loop {
            std::thread::sleep(Duration::from_secs(60));
        },
        "malformed" => {
            println!("not-json-{SECRET}");
            return Ok(());
        }
        "oversized" => {
            let mut stdout = io::stdout().lock();
            stdout.write_all(&vec![b'x'; 1024 * 1024 + 64])?;
            stdout.write_all(b"\n")?;
            stdout.flush()?;
            return Ok(());
        }
        "unsolicited_request" => {
            emit(
                &json!({"id": 88, "method": "item/commandExecution/requestApproval",
                "params": {"command": SECRET}}),
            )?;
            // An approval or further RPC is a test failure. The probe must close/kill us.
            let mut line = String::new();
            let count = reader.read_line(&mut line)?;
            assert_eq!(count, 0, "probe replied to an unrequested server operation");
            return Ok(());
        }
        "rpc_error" => {
            emit(
                &json!({"id": 1, "error": {"code": -32603, "message": SECRET,
                "data": {"accessToken": SECRET}}}),
            )?;
            return Ok(());
        }
        _ => {}
    }

    if scenario == "notifications" {
        emit(&json!({"method": "synthetic/irrelevant", "params": {"value": SECRET}}))?;
    }
    if scenario == "stderr" {
        eprintln!("{SECRET}");
    }
    emit(&json!({"id": 1, "result": {"userAgent": "synthetic quota protocol test"}}))?;
    expect(&mut reader, "initialized", None)?;
    expect(&mut reader, "account/read", Some(2))?;

    match scenario.as_str() {
        "api_key" => {
            emit(&json!({"id":2,"result":{"account":{"type":"apiKey"}}}))?;
            return Ok(());
        }
        "no_account" => {
            emit(&json!({"id":2,"result":{"account":null,"requiresOpenaiAuth":true}}))?;
            return Ok(());
        }
        "no_identity" => {
            emit(&json!({"id":2,"result":{"account":{"type":"chatgpt","planType":"plus"}}}))?;
            return Ok(());
        }
        _ => emit(&account(2, false))?,
    }

    expect(&mut reader, "account/rateLimits/read", Some(3))?;
    if scenario == "notifications" {
        emit(&json!({"method":"account/rateLimits/updated","params":{
            "rateLimits":{"limitId":"codex","primary":{"usedPercent":99}}
        }}))?;
    }
    if scenario == "quota_error" {
        emit(&json!({"id":3,"error":{"code":401,"message":SECRET}}))?;
        return Ok(());
    }
    emit(&json!({"id":3,"result":{
        "ordinaryUsageAllowed":true,
        "rateLimitsByLimitId":{"codex":{
            "limitId":"codex",
            "primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":1893456000}
        }}
    }}))?;

    expect(&mut reader, "account/read", Some(4))?;
    emit(&account(4, scenario == "account_switch"))?;
    // A real peer stays alive until the client closes; no extra outbound methods are allowed.
    let mut extra = String::new();
    let count = reader.read_line(&mut extra)?;
    assert_eq!(
        count, 0,
        "probe sent a method outside the quota-only sequence"
    );
    Ok(())
}
