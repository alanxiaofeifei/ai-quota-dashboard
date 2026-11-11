//! A trusted text-browser shim exercises the real launch path without opening
//! a browser, accessing an AI account, or retaining an authorization URL.
#![cfg(target_os = "linux")]

use ai_quota_preflight::server::frontend_available;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const TRUSTED_BROWSER: &str = r#"
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

status = "failed"
try:
    parts = urllib.parse.urlsplit(sys.argv[1])
    if parts.scheme != "http" or parts.hostname != "127.0.0.1" or not parts.port or parts.path != "/":
        raise ValueError("invalid_local_target")
    fragment = urllib.parse.parse_qs(parts.fragment, strict_parsing=True)
    if list(fragment) != ["bootstrap"] or len(fragment["bootstrap"]) != 1:
        raise ValueError("invalid_bootstrap_fragment")
    bootstrap = fragment["bootstrap"][0]
    if not re.fullmatch(r"[a-f0-9]{64}", bootstrap):
        raise ValueError("invalid_bootstrap")
    origin = "http://127.0.0.1:" + str(parts.port)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(path, method="GET", payload=None, extra=None, limit=32768):
        headers = {"Origin": origin}
        if extra:
            headers.update(extra)
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        item = urllib.request.Request(origin + path, data=body, headers=headers, method=method)
        with opener.open(item, timeout=1) as response:
            content = response.read(limit + 1)
            if response.status != 200 or len(content) > limit:
                raise ValueError("unexpected_http_response")
            return content, response.headers

    # No retry: the server must already be serving before the browser opener
    # waits for this trusted foreground text-browser shim to finish.
    health, _ = request("/api/health")
    if json.loads(health).get("status") != "ok":
        raise ValueError("health_failed")
    shell, _ = request("/")
    if b'id="root"' not in shell and b"id='root'" not in shell:
        raise ValueError("embedded_root_missing")
    script = re.search(rb'<script[^>]+src="([^"]+)"', shell)
    if not script:
        raise ValueError("embedded_script_missing")
    asset = script.group(1).decode("ascii")
    if not asset.startswith("/assets/") or not asset.endswith(".js"):
        raise ValueError("unexpected_asset_path")
    javascript, _ = request(asset, limit=2 * 1024 * 1024)
    if not javascript:
        raise ValueError("embedded_script_empty")
    response, headers = request("/api/session", method="POST", payload={"bootstrap": bootstrap})
    request_key = json.loads(response).get("request_token")
    if not isinstance(request_key, str) or not re.fullmatch(r"[a-f0-9]{64}", request_key):
        raise ValueError("request_verifier_missing")
    cookie = headers.get("Set-Cookie", "").split(";", 1)[0]
    if not cookie:
        raise ValueError("session_cookie_missing")
    accounts, _ = request("/api/accounts", extra={"Cookie": cookie, "X-AI-Quota-Session": request_key})
    if json.loads(accounts) != {"accounts": []}:
        raise ValueError("expected_empty_accounts")
    status = "passed"
except Exception:
    # Exceptions can contain the URL and its bootstrap. Never echo them.
    pass
finally:
    try:
        marker = Path(os.environ["AI_QUOTA_LAUNCH_RESULT"])
        pending = marker.with_suffix(".pending")
        pending.write_text(status, encoding="ascii")
        pending.replace(marker)
    except Exception:
        pass
# Always return success to the opener, even when a check failed. This prevents
# webbrowser from falling back to any real browser installed on the machine.
sys.exit(0)
"#;

struct OwnedDashboard(Option<Child>);

impl OwnedDashboard {
    fn terminate(&mut self) {
        if let Some(child) = self.0.as_mut() {
            // The child starts a new process group, so cleanup cannot target
            // this test runner or an unrelated browser/process by name.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
        }
    }

    fn stop_and_capture(mut self) -> Output {
        self.terminate();
        self.0.take().unwrap().wait_with_output().unwrap()
    }
}

impl Drop for OwnedDashboard {
    fn drop(&mut self) {
        self.terminate();
        if let Some(mut child) = self.0.take() {
            let _ = child.wait();
        }
    }
}

fn assert_no_authorization_output(bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes);
    assert!(!text.contains("#bootstrap="));
    assert!(!text.contains("bootstrap="));
    assert!(!text.contains("request_token"));
    assert!(!text.contains("http://127.0.0.1:"));
    // Recognize the generated secret shape without writing it to a fixture,
    // marker, assertion message, or captured diagnostic file.
    assert!(!bytes.windows(64).any(|part| {
        part.iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    }));
}

#[test]
fn real_launch_serves_embedded_ui_before_waiting_for_browser_authorization() {
    if !frontend_available() {
        // Offline preflight builds remain usable without Node/web dist. CI
        // builds the frontend before Cargo, so the actual launch path runs.
        return;
    }
    let python = Command::new("python3")
        .args(["-I", "-c", "import sys; print(sys.executable)"])
        .output()
        .expect("Linux launch smoke requires Python 3");
    assert!(python.status.success());
    let python = String::from_utf8(python.stdout).unwrap();
    let python = python.trim();
    assert!(Path::new(python).is_absolute());
    assert!(!python.chars().any(char::is_whitespace));
    let directory = tempfile::tempdir().unwrap();
    // webbrowser waits for known text browsers. A generic shim is spawned in
    // the background and would not catch the original launch-order deadlock.
    let shim = directory.path().join("lynx");
    assert!(!shim.to_string_lossy().chars().any(char::is_whitespace));
    fs::write(&shim, format!("#!{python} -I\n{TRUSTED_BROWSER}")).unwrap();
    fs::set_permissions(&shim, fs::Permissions::from_mode(0o700)).unwrap();
    let marker = directory.path().join("launch-result");
    let child = Command::new(env!("CARGO_BIN_EXE_ai-quota-dashboard"))
        .arg("--data-dir")
        .arg(directory.path().join("data"))
        .env_clear()
        .env("BROWSER", &shim)
        .env("PATH", directory.path())
        .env("AI_QUOTA_LAUNCH_RESULT", &marker)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .unwrap();
    let mut dashboard = OwnedDashboard(Some(child));
    let deadline = Instant::now() + Duration::from_secs(8);
    let result = loop {
        if let Ok(value) = fs::read_to_string(&marker) {
            break Some(value);
        }
        if dashboard.0.as_mut().unwrap().try_wait().unwrap().is_some() || Instant::now() >= deadline
        {
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let output = dashboard.stop_and_capture();
    assert_no_authorization_output(&output.stdout);
    assert_no_authorization_output(&output.stderr);
    assert_eq!(
        result.as_deref(),
        Some("passed"),
        "local launch checks failed"
    );
}
