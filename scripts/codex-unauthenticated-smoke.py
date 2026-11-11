#!/usr/bin/env python3
"""Credential-free runtime check of a caller-selected official Codex binary.

No login or model request is implemented. A successful run proves only that an
empty, ephemeral profile is rejected by the published quota endpoint.
"""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time

EXPECTED_VERSION = "0.167.1"
MAX_FRAME = 1024 * 1024
MAX_MESSAGES = 128
CONFIG = '''cli_auth_credentials_store = "ephemeral"
mcp_oauth_credentials_store = "file"
web_search = "disabled"
[history]
persistence = "none"
[analytics]
enabled = false
[feedback]
enabled = false
[otel]
exporter = "none"
trace_exporter = "none"
metrics_exporter = "none"
log_user_prompt = false
[plugins._default]
enabled = false
[features]
plugins = false
remote_plugin = false
plugin_discovery_prefetch = false
apps = false
hooks = false
daemon_auto_start = false
'''


class SmokeError(Exception):
    """Only fixed codes may cross the diagnostics boundary."""


def clean_environment(profile, temporary):
    environment = {"PATH": os.defpath, "CODEX_HOME": str(profile),
                   "TEMP": str(temporary), "TMP": str(temporary)}
    # Do not alter HOME, USERPROFILE, or CODEX_HOME in the parent process.
    # A child-specific CODEX_HOME serves its documented purpose. Authentication,
    # proxy, OTEL and client-specific environment variables are not inherited.
    if os.name == "nt":
        for name in ("SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"):
            if name in os.environ:
                environment[name] = os.environ[name]
    return environment


def _remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise SmokeError("deadline_exceeded")
    return value


def _terminate(process):
    # Restrict cleanup to this owned process tree. Never match process names.
    if os.name == "nt":
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        taskkill = str(Path(system_root) / "System32" / "taskkill.exe")
        try:
            subprocess.run([taskkill, "/PID", str(process.pid), "/T", "/F"],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=2, check=False)
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
    try:
        process.kill()
    except OSError:
        pass
    try:
        process.wait(timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        pass


class _Peer:
    def __init__(self, command, environment, cwd):
        kwargs = {"env": environment, "cwd": cwd, "stdin": subprocess.PIPE,
                  "stdout": subprocess.PIPE, "stderr": subprocess.DEVNULL}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        try:
            self.process = subprocess.Popen(command, **kwargs)
        except OSError:
            raise SmokeError("client_start_failed") from None
        self.messages = queue.Queue(maxsize=8)
        self.stopped = threading.Event()

    def start_reader(self, version=False):
        def deliver(value):
            while not self.stopped.is_set():
                try:
                    self.messages.put(value, timeout=.05)
                    return True
                except queue.Full:
                    pass
            return False

        def read():
            try:
                if version:
                    value = self.process.stdout.read(MAX_FRAME + 1)
                    deliver(("bytes", value))
                    return
                for _ in range(MAX_MESSAGES):
                    value = self.process.stdout.readline(MAX_FRAME + 1)
                    if not value:
                        deliver(("error", "peer_closed"))
                        return
                    if len(value) > MAX_FRAME:
                        deliver(("error", "frame_too_large"))
                        return
                    try:
                        message = json.loads(value)
                    except (UnicodeError, ValueError):
                        deliver(("error", "invalid_peer_frame"))
                        return
                    if not deliver(("message", message)):
                        return
                deliver(("error", "message_limit_exceeded"))
            except (OSError, ValueError):
                deliver(("error", "peer_io_failed"))
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def next(self, deadline):
        try:
            kind, value = self.messages.get(timeout=_remaining(deadline))
        except queue.Empty:
            raise SmokeError("deadline_exceeded") from None
        if kind == "error":
            raise SmokeError(value)
        return value

    def send(self, message):
        try:
            self.process.stdin.write(json.dumps(message, separators=(",", ":")).encode() + b"\n")
            self.process.stdin.flush()
        except OSError:
            raise SmokeError("peer_io_failed") from None

    def close(self):
        self.stopped.set()
        _terminate(self.process)
        # The reader is daemonized and cleanup is bounded even for inherited
        # pipes. All normal peers are reaped above; no raw stream is retained.
        self.reader.join(timeout=.1)
        for stream in (self.process.stdin, self.process.stdout):
            if stream is not None and not self.reader.is_alive():
                try:
                    stream.close()
                except OSError:
                    pass


def _response(peer, request_id, deadline):
    for _ in range(MAX_MESSAGES):
        value = peer.next(deadline)
        if not isinstance(value, dict):
            raise SmokeError("invalid_peer_frame")
        if "method" in value:
            if "id" in value:
                raise SmokeError("unexpected_server_request")
            if not isinstance(value["method"], str):
                raise SmokeError("invalid_peer_frame")
            continue
        if type(value.get("id")) is not int or value["id"] != request_id:
            raise SmokeError("unexpected_response_id")
        return value
    raise SmokeError("message_limit_exceeded")


def _result(value):
    if value.get("error") is not None or not isinstance(value.get("result"), dict):
        raise SmokeError("unexpected_rpc_result")
    return value["result"]


def _smoke_command(command, kind="cli", expected_version=EXPECTED_VERSION, timeout=12):
    """Internal list-command seam used by synthetic subprocess tests."""
    if kind not in ("cli", "app-server") or expected_version != EXPECTED_VERSION:
        raise SmokeError("unsupported_client_contract")
    if not 0 < timeout <= 12:
        raise SmokeError("invalid_timeout")
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryDirectory(prefix="ai-quota-noauth-") as temporary:
        base = Path(temporary)
        profile, cwd = base / "profile", base / "work"
        profile.mkdir(mode=0o700)
        cwd.mkdir(mode=0o700)
        descriptor = os.open(profile / "config.toml", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as config:
            config.write(CONFIG)
        environment = clean_environment(profile, base)
        version_peer = _Peer([*command, "--version"], environment, cwd)
        version_peer.start_reader(version=True)
        try:
            version = version_peer.next(deadline)
            if len(version) > MAX_FRAME:
                raise SmokeError("version_output_too_large")
            try:
                text = version.decode("ascii").strip()
            except UnicodeError:
                raise SmokeError("unexpected_client_version") from None
            if not re.fullmatch(r"(?:codex-cli|codex-app-server) " + re.escape(expected_version), text):
                raise SmokeError("unexpected_client_version")
        finally:
            version_peer.close()
        arguments = (["app-server", "--stdio", "--strict-config"] if kind == "cli"
                     else ["--listen", "stdio://", "--strict-config"])
        peer = _Peer([*command, *arguments], environment, cwd)
        peer.start_reader()
        try:
            peer.send({"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "ai-quota-unauth-smoke", "version": "0.1.0"},
                "capabilities": {"experimentalApi": False}}})
            _result(_response(peer, 1, deadline))
            peer.send({"method": "initialized"})
            peer.send({"id": 2, "method": "account/read", "params": {"refreshToken": False}})
            account = _result(_response(peer, 2, deadline))
            if "account" not in account or account["account"] is not None:
                raise SmokeError("unexpected_authenticated_account")
            if account.get("requiresOpenaiAuth") is not True:
                raise SmokeError("unexpected_authentication_contract")
            peer.send({"id": 3, "method": "account/rateLimits/read"})
            refusal = _response(peer, 3, deadline)
            error = refusal.get("error")
            if ("result" in refusal or not isinstance(error, dict)
                    or error.get("code") != -32600
                    or error.get("message") != "codex account authentication required to read rate limits"):
                raise SmokeError("expected_authentication_refusal_missing")
        finally:
            peer.close()
        return {
            "schema_version": 1,
            "evidence_level": "unauthenticated_runtime",
            "client_version": expected_version,
            "client_kind": kind,
            "isolated_ephemeral_profile": True,
            "account_is_null": True,
            "quota_request_authentication_refused": True,
            "quota_error_code": -32600,
            "observed_usage": None,
            "real_account_verified": False,
            "login_requested": False,
            "model_turn_requested": False,
            "network_blocked": False,
            "notes": "Authentication refusal is not a quota measurement or zero balance. Network isolation is not asserted.",
        }


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise SmokeError("invalid_arguments")


def main(argv=None):
    parser = _Parser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--kind", choices=("cli", "app-server"), default="cli")
    parser.add_argument("--expect-version", default=EXPECTED_VERSION)
    try:
        args = parser.parse_args(argv)
        binary = Path(args.binary)
        if not binary.is_absolute() or not binary.is_file():
            raise SmokeError("absolute_client_binary_required")
        report = _smoke_command([str(binary)], args.kind, args.expect_version)
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except SmokeError as error:
        print(json.dumps({"status": "failed", "error": str(error), "real_account_verified": False}))
        return 1
    except Exception:
        print(json.dumps({"status": "failed", "error": "smoke_failed", "real_account_verified": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
