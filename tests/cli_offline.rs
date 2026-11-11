use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::{Command, Output};

const SECRET: &str = "SYNTHETIC_SECRET_MUST_NOT_ESCAPE";

fn cli() -> Command {
    Command::new(env!("CARGO_BIN_EXE_ai-quota-preflight"))
}

fn parse(input: &Path, output: &Path) -> Output {
    cli()
        .arg("parse-codex")
        .arg("--input")
        .arg(input)
        .arg("--output")
        .arg(output)
        .output()
        .unwrap()
}

fn write_quota(path: &Path) {
    let value = json!({
        "id": 3,
        "result": {
            "email": "synthetic@example.invalid",
            "accessToken": SECRET,
            "rateLimits": {"limitId":"codex", "primary":{"usedPercent":88}},
            "rateLimitsByLimitId": {
                "codex": {
                    "limitId":"codex", "limitName": SECRET,
                    "primary": {"usedPercent":null, "windowDurationMins":300,
                        "resetsAt":1730947200},
                    "secondary": {"usedPercent":25, "windowDurationMins":10080,
                        "resetsAt":1730947200}
                }
            }
        }
    });
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
}

fn assert_no_secret(output: &Output) {
    for bytes in [&output.stdout, &output.stderr] {
        let text = String::from_utf8_lossy(bytes);
        assert!(!text.contains(SECRET));
        assert!(!text.contains("synthetic@example.invalid"));
    }
}

#[test]
fn doctor_reports_every_live_gate_as_pending_without_private_paths() {
    let directory = tempfile::tempdir().unwrap();
    let output = cli()
        .arg("doctor")
        .current_dir(directory.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let data: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(data["stage0"]["status"], "blocked");
    assert_eq!(data["live_probe_enabled"], false);
    for check in ["client_launched", "credentials_read", "network_used"] {
        assert_eq!(data["checks"][check], false);
    }
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains(&directory.path().to_string_lossy().to_string()));
    assert!(!text.contains("auth.json"));
}

#[test]
fn offline_import_deduplicates_and_preserves_unknown_usage_without_claiming_freshness() {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("quota.json");
    let output_path = directory.path().join("report.json");
    write_quota(&input);
    let output = parse(&input, &output_path);
    assert!(output.status.success());
    assert_no_secret(&output);
    let bytes = fs::read(output_path).unwrap();
    let report: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(report["mode"], "offline_import");
    assert!(report["observed_at_unix_seconds"].is_null());
    assert!(report["processed_at_unix_seconds"].is_u64());
    assert_eq!(report["freshness"], "unverified");
    assert_eq!(report["account_verification"], "not_performed");
    let buckets = report["data"]["buckets"].as_array().unwrap();
    assert_eq!(buckets.len(), 1);
    assert!(buckets[0]["primary"]["used_percent"].is_null());
    assert_eq!(
        buckets[0]["primary"]["resets_at_unix_seconds"],
        1730947200u64
    );
    assert_eq!(buckets[0]["secondary"]["used_percent"], 25.0);
    let text = String::from_utf8(bytes).unwrap();
    for forbidden in [
        SECRET,
        "synthetic@example.invalid",
        "accessToken",
        "limitName",
    ] {
        assert!(
            !text.contains(forbidden),
            "normalized report contains {forbidden}"
        );
    }
    assert!(!text.contains("recovered"));
    assert!(!text.contains("restored"));
}

#[test]
fn invalid_json_never_echoes_input_or_creates_an_output() {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("broken.json");
    let report = directory.path().join("report.json");
    fs::write(&input, format!("{{invalid-{SECRET}")).unwrap();
    let output = parse(&input, &report);
    assert_eq!(output.status.code(), Some(2));
    assert_no_secret(&output);
    assert!(output.stdout.is_empty());
    assert!(!report.exists());
}

#[test]
fn rejects_named_credential_files_before_parsing() {
    let directory = tempfile::tempdir().unwrap();
    for name in [
        "auth.json",
        "AUTH.JSON",
        "Cookies",
        "cookies.sqlite",
        "Login Data",
        ".env.local",
    ] {
        let input = directory.path().join(name);
        let report = directory.path().join("report.json");
        write_quota(&input);
        let output = parse(&input, &report);
        assert_eq!(output.status.code(), Some(2), "credential filename {name}");
        assert_eq!(
            String::from_utf8_lossy(&output.stderr).trim(),
            "credential_file_not_accepted"
        );
        assert_no_secret(&output);
        assert!(!report.exists());
    }
}

#[test]
fn never_overwrites_an_existing_report_or_the_input() {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("quota.json");
    let report = directory.path().join("report.json");
    write_quota(&input);
    fs::write(&report, b"existing-report").unwrap();
    assert!(!parse(&input, &report).status.success());
    assert_eq!(fs::read(&report).unwrap(), b"existing-report");
    let original = fs::read(&input).unwrap();
    assert!(!parse(&input, &input).status.success());
    assert_eq!(fs::read(&input).unwrap(), original);
}

#[cfg(unix)]
#[test]
fn never_follows_an_existing_output_symlink() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("quota.json");
    let target = directory.path().join("keep.json");
    let report = directory.path().join("report.json");
    write_quota(&input);
    fs::write(&target, b"do-not-overwrite").unwrap();
    symlink(&target, &report).unwrap();
    assert!(!parse(&input, &report).status.success());
    assert_eq!(fs::read(&target).unwrap(), b"do-not-overwrite");
    assert!(fs::symlink_metadata(report)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[cfg(unix)]
#[test]
fn rejects_a_symlink_input_even_with_an_innocent_alias() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let credential = directory.path().join("auth.json");
    let alias = directory.path().join("quota.json");
    let report = directory.path().join("report.json");
    write_quota(&credential);
    symlink(&credential, &alias).unwrap();
    let output = parse(&alias, &report);
    assert!(!output.status.success());
    assert_no_secret(&output);
    assert!(!report.exists());
}

#[cfg(unix)]
#[test]
fn rejects_fifo_input_without_blocking_on_open() {
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    let directory = tempfile::tempdir().unwrap();
    let fifo = directory.path().join("quota.json");
    let report = directory.path().join("report.json");
    assert!(Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    let mut child = cli()
        .arg("parse-codex")
        .arg("--input")
        .arg(&fifo)
        .arg("--output")
        .arg(&report)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("FIFO input blocked instead of failing before reading");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    assert!(!report.exists());
}

#[test]
fn oversized_input_is_rejected_without_a_report() {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("large.json");
    let report = directory.path().join("report.json");
    fs::write(&input, vec![b'x'; 1024 * 1024 + 1]).unwrap();
    let output = parse(&input, &report);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "input_too_large"
    );
    assert!(!report.exists());
}

#[test]
fn duplicate_unknown_or_incomplete_options_are_rejected_without_echo() {
    for arguments in [
        vec!["doctor", "--output", "a", "--output", SECRET],
        vec!["doctor", "--unknown", SECRET],
        vec!["doctor", "--output"],
        vec!["parse-codex", "--input", "a", "--input", SECRET],
        vec!["parse-codex", "--unknown", SECRET],
    ] {
        let output = cli().args(arguments).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert_no_secret(&output);
    }
}

#[test]
fn live_probe_cannot_be_enabled_by_flags_and_never_launches_a_client() {
    let directory = tempfile::tempdir().unwrap();
    let sentinel = directory.path().join("client-was-launched");
    let fake_client = directory
        .path()
        .join(if cfg!(windows) { "codex.cmd" } else { "codex" });
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(
            &fake_client,
            format!("#!/bin/sh\nprintf launched > '{}'\n", sentinel.display()),
        )
        .unwrap();
        fs::set_permissions(&fake_client, fs::Permissions::from_mode(0o700)).unwrap();
    }
    #[cfg(windows)]
    fs::write(
        &fake_client,
        format!(
            "@echo off\r\necho launched > \"{}\"\r\n",
            sentinel.display()
        ),
    )
    .unwrap();
    let report = directory.path().join("report.json");
    let output = cli()
        .arg("probe-codex")
        .arg("--codex")
        .arg(&fake_client)
        .arg("--ack-policy-reviewed")
        .arg("--ack-local-auth-refresh")
        .arg("--output")
        .arg(&report)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&output.stderr).contains("live_probe_unverified"));
    assert!(!sentinel.exists());
    assert!(!report.exists());
}

#[cfg(unix)]
#[test]
fn report_files_are_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let report = directory.path().join("doctor.json");
    let output = cli()
        .arg("doctor")
        .arg("--output")
        .arg(&report)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        fs::metadata(report).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
