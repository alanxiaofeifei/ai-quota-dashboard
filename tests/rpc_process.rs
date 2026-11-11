#![cfg(feature = "test-support")]

use ai_quota_preflight::rpc::probe_with_command;
use serde_json::Value;
use std::process::Command;
use std::time::{Duration, Instant};

const SECRET: &str = "SYNTHETIC_SECRET_MUST_NOT_ESCAPE";

fn command(scenario: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_quota-mock-app-server"));
    command.arg(scenario);
    command
}

fn assert_safe_error(scenario: &str) {
    let result = probe_with_command(command(scenario), Duration::from_secs(2));
    let error = match result {
        Ok(_) => panic!("scenario {scenario} must not produce a quota report"),
        Err(error) => error,
    };
    assert!(!error.to_string().contains(SECRET));
    assert!(!format!("{error:?}").contains(SECRET));
}

fn report(scenario: &str) -> Value {
    let report = probe_with_command(command(scenario), Duration::from_secs(2))
        .unwrap_or_else(|error| panic!("synthetic scenario {scenario} failed: {error}"));
    let serialized = serde_json::to_string(&report).unwrap();
    for forbidden in [
        SECRET,
        "example.invalid",
        "synthetic-account",
        "accessToken",
    ] {
        assert!(!serialized.contains(forbidden), "report leaked {forbidden}");
    }
    serde_json::from_str(&serialized).unwrap()
}

#[test]
fn completes_exact_quota_only_handshake_without_exporting_account_identity() {
    let report = report("success");
    let buckets = report["buckets"]
        .as_array()
        .expect("normalized quota buckets");
    assert_eq!(buckets.len(), 1);
    assert_eq!(buckets[0]["limit_id"], "codex");
    assert_eq!(buckets[0]["primary"]["used_percent"], 25.0);
}

#[test]
fn notifications_cannot_replace_the_requested_observation() {
    let report = report("notifications");
    assert_eq!(report["buckets"][0]["primary"]["used_percent"], 25.0);
}

#[test]
fn child_stderr_is_neither_forwarded_nor_included_in_the_report() {
    let output = command("capture_stderr").output().unwrap();
    assert!(output.status.success());
    assert!(!String::from_utf8_lossy(&output.stdout).contains(SECRET));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(SECRET));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["buckets"][0]["primary"]["used_percent"], 25.0);
}

#[test]
fn rejects_api_key_authentication() {
    assert_safe_error("api_key");
}

#[test]
fn rejects_missing_authentication() {
    assert_safe_error("no_account");
}

#[test]
fn rejects_an_account_without_a_stable_identity() {
    assert_safe_error("no_identity");
}

#[test]
fn discards_quota_when_the_active_account_changes() {
    assert_safe_error("account_switch");
}

#[test]
fn upstream_error_payloads_are_not_reproduced() {
    assert_safe_error("rpc_error");
    assert_safe_error("quota_error");
}

#[test]
fn rejects_non_json_output_without_echoing_it() {
    assert_safe_error("malformed");
}

#[test]
fn rejects_oversized_frames() {
    assert_safe_error("oversized");
}

#[test]
fn fails_closed_on_unsolicited_server_requests() {
    assert_safe_error("unsolicited_request");
}

#[test]
fn enforces_a_deadline_and_reaps_the_hanging_child() {
    let directory = tempfile::tempdir().unwrap();
    let pid_file = directory.path().join("synthetic-child.pid");
    let mut child = command("hang");
    child.arg(&pid_file);
    let start = Instant::now();
    let result = probe_with_command(child, Duration::from_millis(300));
    assert!(result.is_err());
    assert!(start.elapsed() < Duration::from_secs(2));
    // On Linux the PID disappears only after wait/reap. Other platforms still verify deadline.
    #[cfg(target_os = "linux")]
    {
        let pid = std::fs::read_to_string(pid_file).expect("mock must have started");
        assert!(!std::path::Path::new("/proc").join(pid).exists());
    }
}

#[test]
fn cleanup_does_not_wait_for_a_descendant_holding_stdout() {
    let started = Instant::now();
    let result = probe_with_command(command("descendant_stdout"), Duration::from_secs(2));
    assert!(result.is_ok());
    assert!(started.elapsed() < Duration::from_millis(900));
}
