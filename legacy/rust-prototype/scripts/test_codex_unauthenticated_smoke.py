"""Synthetic peers only: never invokes installed Codex or uses real accounts."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "codex_unauthenticated_smoke", Path(__file__).with_name("codex-unauthenticated-smoke.py"))
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)
SECRET = "SYNTHETIC_SECRET_NOT_FOR_REPORTS"
FAKE = r'''
import json, os, sys, time
mode = sys.argv[1]
if "--version" in sys.argv:
    print("secret-version-value" if mode == "wrong_version" else "codex-cli 0.167.1")
    raise SystemExit(0)
assert sys.argv[2:] in (["app-server", "--stdio", "--strict-config"], ["--listen", "stdio://", "--strict-config"])
assert "OPENAI_API_KEY" not in os.environ
assert "CODEX_ACCESS_TOKEN" not in os.environ
assert "HTTP_PROXY" not in os.environ
assert "HOME" not in os.environ
profile = os.environ["CODEX_HOME"]
assert os.path.isfile(os.path.join(profile, "config.toml"))
assert "ephemeral" in open(os.path.join(profile, "config.toml")).read()
def receive(method, identifier=None):
    value = json.loads(sys.stdin.readline())
    assert value["method"] == method
    assert value.get("id") == identifier
    if method == "account/read":
        assert value["params"]["refreshToken"] is False
    return value
def emit(value):
    print(json.dumps(value), flush=True)
receive("initialize", 1)
if mode == "hang":
    time.sleep(10)
if mode == "malformed":
    print("SYNTHETIC_SECRET_NOT_FOR_REPORTS not-json", flush=True)
    raise SystemExit(0)
if mode == "unsolicited":
    emit({"id": 99, "method": "item/commandExecution/requestApproval", "params": {"secret": "SYNTHETIC_SECRET_NOT_FOR_REPORTS"}})
    time.sleep(2)
    raise SystemExit(0)
if mode == "oversized":
    print("x" * (1024 * 1024 + 1), flush=True)
    raise SystemExit(0)
emit({"id": 1, "result": {"untrusted": "SYNTHETIC_SECRET_NOT_FOR_REPORTS"}})
receive("initialized")
receive("account/read", 2)
account = {"email":"SYNTHETIC_SECRET_NOT_FOR_REPORTS"} if mode == "authenticated" else None
emit({"id":2,"result":{"account":account,"requiresOpenaiAuth":mode != "wrong_provider"}})
if mode in ("authenticated", "wrong_provider"):
    time.sleep(2)
    raise SystemExit(0)
receive("account/rateLimits/read", 3)
if mode == "quota_result":
    emit({"id":3,"result":{"rateLimits":{"secret":"SYNTHETIC_SECRET_NOT_FOR_REPORTS"}}})
elif mode == "wrong_error":
    emit({"id":3,"error":{"code":-32603,"message":"SYNTHETIC_SECRET_NOT_FOR_REPORTS"}})
elif mode == "wrong_message":
    emit({"id":3,"error":{"code":-32600,"message":"SYNTHETIC_SECRET_NOT_FOR_REPORTS"}})
else:
    print("SYNTHETIC_SECRET_NOT_FOR_REPORTS", file=sys.stderr, flush=True)
    emit({"id":3,"error":{"code":-32600,"message":"codex account authentication required to read rate limits", "data":{"secret":"SYNTHETIC_SECRET_NOT_FOR_REPORTS"}}})
sys.stdin.readline()
'''


class UnauthenticatedSmokeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="quota-synthetic-peer-")
        self.addCleanup(self.directory.cleanup)
        self.peer = Path(self.directory.name) / "peer.py"
        self.peer.write_text(FAKE, encoding="utf-8")

    def run_peer(self, mode="normal", kind="cli", timeout=3):
        return smoke._smoke_command([sys.executable, str(self.peer), mode],
                                    kind=kind, timeout=timeout)

    def assert_safe_failure(self, mode):
        with self.assertRaises(smoke.SmokeError) as caught:
            self.run_peer(mode)
        self.assertNotIn(SECRET, str(caught.exception))
        self.assertNotIn("secret-version", str(caught.exception))

    def test_success_is_only_an_authentication_refusal_not_usage(self):
        report = self.run_peer()
        self.assertEqual(report["evidence_level"], "unauthenticated_runtime")
        self.assertEqual(report["quota_error_code"], -32600)
        self.assertIsNone(report["observed_usage"])
        self.assertFalse(report["real_account_verified"])
        self.assertFalse(report["network_blocked"])
        self.assertFalse(report["login_requested"])
        self.assertFalse(report["model_turn_requested"])
        self.assertNotIn(SECRET, json.dumps(report))

    def test_parent_credentials_and_home_are_not_inherited_or_changed(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": SECRET, "CODEX_ACCESS_TOKEN": SECRET,
                                    "HTTP_PROXY": SECRET, "HOME": SECRET}):
            self.run_peer()
            self.assertEqual(os.environ["OPENAI_API_KEY"], SECRET)
            self.assertEqual(os.environ["HOME"], SECRET)

    def test_standalone_contract_supported_without_changing_evidence(self):
        self.assertEqual(self.run_peer(kind="app-server")["client_kind"], "app-server")

    def test_authentication_and_quota_success_abort_without_payload(self):
        for mode in ("authenticated", "wrong_provider", "quota_result"):
            with self.subTest(mode=mode):
                self.assert_safe_failure(mode)

    def test_wrong_version_and_other_rpc_error_fail_safely(self):
        for mode in ("wrong_version", "wrong_error", "wrong_message"):
            with self.subTest(mode=mode):
                self.assert_safe_failure(mode)

    def test_malformed_large_and_unsolicited_frames_fail_safely(self):
        for mode in ("malformed", "oversized", "unsolicited"):
            with self.subTest(mode=mode):
                self.assert_safe_failure(mode)

    def test_deadline_is_bounded_for_hanging_peer(self):
        import time
        start = time.monotonic()
        with self.assertRaises(smoke.SmokeError) as caught:
            self.run_peer("hang", timeout=.2)
        self.assertEqual(str(caught.exception), "deadline_exceeded")
        # Windows tree cleanup includes one bounded taskkill attempt.
        self.assertLess(time.monotonic() - start, 4)

    def test_environment_has_no_parent_home_or_auth_variables(self):
        environment = smoke.clean_environment(Path("profile"), Path("temporary"))
        for name in ("HOME", "USERPROFILE", "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN", "HTTP_PROXY"):
            self.assertNotIn(name, environment)

    def test_only_reviewed_version_and_bounded_timeout_are_accepted(self):
        for kwargs in ({"expected_version":"999.0.0"}, {"kind":"shell"}, {"timeout":0}, {"timeout":15}):
            with self.subTest(kwargs=kwargs), self.assertRaises(smoke.SmokeError):
                smoke._smoke_command([sys.executable], **kwargs)


if __name__ == "__main__":
    unittest.main()
