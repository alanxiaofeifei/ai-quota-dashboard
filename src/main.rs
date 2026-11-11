use ai_quota_preflight::quota::parse_codex_rate_limits;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_INPUT_BYTES: u64 = 1024 * 1024;
const HELP: &str = "AI Quota Preflight — 阶段 0，本地离线验证工具\n\
用法：\n\
  ai-quota-preflight doctor [--output <新报告.json>]\n\
  ai-quota-preflight parse-codex --input <额度.json> --output <新报告.json>\n\
  ai-quota-preflight probe-codex\n\
doctor 不启动客户端或读取认证。parse-codex 只导出已识别的额度字段。\n\
真实采集尚未通过发行版、政策和 Windows 实账验证，probe-codex 始终拒绝启动。\n\
本工具不登录、不上传、不读取聊天，不将导入时间当作额度观测时间。";

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let args: Result<Vec<_>, _> = args.into_iter().map(|s| s.into_string()).collect();
    let result = args.map_err(|_| (2, "invalid_arguments")).and_then(run);
    if let Err((code, message)) = result {
        // Never echo untrusted arguments, file content, or upstream errors.
        eprintln!("{message}");
        std::process::exit(code);
    }
}

fn run(args: Vec<String>) -> Result<(), (i32, &'static str)> {
    let Some(command) = args.first().map(String::as_str) else {
        println!("{HELP}");
        return Ok(());
    };
    if matches!(command, "--help" | "-h") && args.len() == 1 {
        println!("{HELP}");
        return Ok(());
    }
    if command == "--version" && args.len() == 1 {
        println!("ai-quota-preflight {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    match command {
        "doctor" => {
            let options = options(&args[1..], &["--output"])?;
            let report = json!({
                "schema_version": 1,
                "mode": "offline_diagnostics",
                "tool_version": env!("CARGO_PKG_VERSION"),
                "host": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH},
                "generated_at_unix_seconds": now(),
                "stage0": {
                    "target": "authenticated_codex_rpc",
                    "status": "blocked",
                    "new_client_policy": "pending_review",
                    "official_client_build": "not_verified",
                    "windows_runtime": "not_tested",
                    "account_ui_comparison": "not_tested",
                    "startup_and_auth_isolation": "not_tested"
                },
                "foreground_browser_source": {
                    "field_comparison": "user_reported_match",
                    "account_binding": "user_assigned_not_verified",
                    "background_refresh": "not_implemented"
                },
                "checks": {"client_launched": false, "credentials_read": false, "network_used": false},
                "live_probe_enabled": false
            });
            if let Some(path) = options.get("--output") {
                write_report(Path::new(path), &report)?;
            } else {
                println!("{}", serde_json::to_string_pretty(&report).map_err(|_| (1, "serialization_failed"))?);
            }
            Ok(())
        }
        "parse-codex" => {
            let options = options(&args[1..], &["--input", "--output"])?;
            let input = options.get("--input").ok_or((2, "input_required"))?;
            let output = options.get("--output").ok_or((2, "output_required"))?;
            if input == output {
                return Err((2, "input_and_output_must_differ"));
            }
            let path = Path::new(input);
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
            if matches!(name.as_str(), "auth.json" | "cookies" | "cookies.sqlite" | "login data") || name.starts_with(".env") {
                return Err((2, "credential_file_not_accepted"));
            }
            let metadata = fs::symlink_metadata(path).map_err(|_| (1, "input_unreadable"))?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err((2, "input_must_be_regular_file"));
            }
            let mut input_options = OpenOptions::new();
            input_options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                input_options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                input_options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
            }
            let file = input_options.open(path).map_err(|_| (1, "input_unreadable"))?;
            if !file.metadata().map_err(|_| (1, "input_unreadable"))?.is_file() {
                return Err((2, "input_must_be_regular_file"));
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if file.metadata().map_err(|_| (1, "input_unreadable"))?.file_attributes() & 0x400 != 0 {
                    return Err((2, "input_must_be_regular_file"));
                }
            }
            let mut bytes = Vec::new();
            file.take(MAX_INPUT_BYTES + 1).read_to_end(&mut bytes).map_err(|_| (1, "input_unreadable"))?;
            if bytes.len() as u64 > MAX_INPUT_BYTES {
                return Err((2, "input_too_large"));
            }
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| (2, "invalid_json"))?;
            let data = parse_codex_rate_limits(&value).map_err(|_| (2, "invalid_quota_response"))?;
            let report = json!({
                "schema_version": 1,
                "mode": "offline_import",
                "source": "user_supplied_codex_rate_limits_json",
                "observed_at_unix_seconds": null,
                "processed_at_unix_seconds": now(),
                "freshness": "unverified",
                "account_verification": "not_performed",
                "data": data
            });
            write_report(Path::new(output), &report)
        }
        // No flag, build feature, or acknowledgement can unlock a real process.
        "probe-codex" => Err((3, "live_probe_unverified: official build, policy, Windows account and startup isolation gates are not passed")),
        _ => Err((2, "unknown_command")),
    }
}

fn options<'a>(
    args: &'a [String],
    allowed: &[&str],
) -> Result<BTreeMap<&'a str, &'a str>, (i32, &'static str)> {
    let (pairs, remainder) = args.as_chunks::<2>();
    if !remainder.is_empty() {
        return Err((2, "invalid_arguments"));
    }
    let mut result = BTreeMap::new();
    for pair in pairs {
        if !allowed.contains(&pair[0].as_str())
            || pair[1].is_empty()
            || result.insert(pair[0].as_str(), pair[1].as_str()).is_some()
        {
            return Err((2, "invalid_arguments"));
        }
    }
    Ok(result)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_report(path: &Path, report: &Value) -> Result<(), (i32, &'static str)> {
    let bytes = serde_json::to_vec_pretty(report).map_err(|_| (1, "serialization_failed"))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| (1, "output_must_be_new_writable_file"))?;
    if file
        .write_all(&bytes)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .is_err()
    {
        drop(file);
        let _ = fs::remove_file(path);
        return Err((1, "output_write_failed"));
    }
    println!("report_written");
    Ok(())
}
