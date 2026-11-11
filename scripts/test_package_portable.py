import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("package_portable", Path(__file__).with_name("package-portable.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PortablePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.notices = self.root / "notices"
        self.notices.mkdir()
        for name in ("LICENSE", "THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_MANIFEST.json"):
            (self.notices / name).write_text("synthetic notice", encoding="utf-8")
        (self.root / "LICENSE").write_text("Synthetic project license", encoding="utf-8")
        (self.root / "Cargo.toml").write_text('[package]\nversion = "0.3.1"\n', encoding="utf-8")
        binaries = self.root / "target/release"
        binaries.mkdir(parents=True)
        for name in ("ai-quota-dashboard", "ai-quota-preflight"):
            (binaries / (name + ".exe")).write_bytes(b"synthetic binary")
        extension = self.root / "browser-extension"
        extension.mkdir()
        (extension / "manifest.json").write_text(json.dumps({"manifest_version": 3, "name": "Synthetic reader"}), encoding="utf-8")
        (extension / "popup.html").write_text("<p>Synthetic reader</p>", encoding="utf-8")
        self.manifest = self.root / "source-manifest.json"
        self.entries = [{"path": f"browser-extension/{file.name}", "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
                        for file in sorted(extension.iterdir())]
        self.write_manifest()
        self.output = self.root / "packages"

    def write_manifest(self):
        self.manifest.write_text(json.dumps({"schema_version": 1, "functional_source_sha256": "a" * 64, "files": self.entries}), encoding="utf-8")

    def prepare(self):
        packager.prepare(self.root, self.notices, self.manifest, self.output, "win32")

    def test_windows_bundle_separates_reader_and_preserves_notices_sources_and_hashes(self):
        (self.root / "browser-extension/private-untracked.json").write_text("synthetic private data", encoding="utf-8")
        self.prepare()
        dashboard = self.output / "ai-quota-dashboard"
        self.assertTrue((dashboard / "ai-quota-dashboard.exe").is_file())
        self.assertFalse((dashboard / "manifest.json").exists())
        self.assertTrue((dashboard / "browser-extension/manifest.json").is_file())
        self.assertFalse((dashboard / "browser-extension/private-untracked.json").exists())
        self.assertTrue((dashboard / "THIRD_PARTY_MANIFEST.json").is_file())
        self.assertTrue((dashboard / "SOURCE_MANIFEST.json").is_file())
        self.assertIn("browser-extension", (dashboard / "START-HERE.txt").read_text(encoding="utf-8"))
        digest = hashlib.sha256((dashboard / "ai-quota-dashboard.exe").read_bytes()).hexdigest()
        self.assertEqual((dashboard / "SHA256SUMS").read_text(), f"{digest}  ai-quota-dashboard.exe\n")
        self.assertTrue((self.output / "quota-usage-selection-validator/manifest.json").is_file())

    def test_existing_output_is_not_overwritten(self):
        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_text("preserve")
        with self.assertRaisesRegex(packager.PackageError, "package_output_exists"):
            self.prepare()
        self.assertEqual(marker.read_text(), "preserve")
        self.assertEqual(list(self.output.iterdir()), [marker])

    def test_changed_extension_is_not_packaged_under_an_older_source_fingerprint(self):
        (self.root / "browser-extension/popup.html").write_text("changed source", encoding="utf-8")
        with self.assertRaisesRegex(packager.PackageError, "package_extension_source_mismatch"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_traversal_and_ambiguous_root_manifest_are_rejected(self):
        self.entries.append({"path": "browser-extension/../private.json", "sha256": "b" * 64})
        self.write_manifest()
        with self.assertRaisesRegex(packager.PackageError, "package_source_manifest_invalid"):
            self.prepare()
        self.assertFalse(self.output.exists())
        self.entries.pop()
        self.write_manifest()
        (self.notices / "manifest.json").write_text("legacy license index")
        with self.assertRaisesRegex(packager.PackageError, "package_ambiguous_manifest_rejected"):
            self.prepare()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
