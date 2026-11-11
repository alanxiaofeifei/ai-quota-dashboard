#!/usr/bin/env python3
"""Collect release notices from installed, locked dependencies without network IO.

Run after cargo fetch --locked and npm ci --prefix web. The output directory
must not exist. Keep its contents alongside each distributed executable.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit


ROOT = Path(__file__).resolve().parent.parent
TARGETS = ("x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc")
SUPPORTED = {
    "MIT", "MIT OR Apache-2.0", "Apache-2.0 OR MIT", "MIT/Apache-2.0",
    "Apache-2.0", "Apache-2.0 OR BSL-1.0", "Unlicense OR MIT",
    "MIT AND BSD-3-Clause", "BSD-3-Clause", "Unicode-3.0", "Zlib",
    "(MIT OR Apache-2.0) AND Unicode-3.0", "MPL-2.0",
}


class NoticeError(Exception):
    """A safe error message, without environment or cache paths."""


def command(arguments: list[str]) -> str:
    try:
        result = subprocess.run(
            arguments, cwd=ROOT, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        raise NoticeError("Required offline Cargo/Rust metadata is unavailable.") from None
    return result.stdout


def regular_file(path: Path, root: Path) -> Path:
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise NoticeError("Expected a regular dependency notice/source file.")
    return path


def copy_file(source: Path, root: Path, output: Path, relative: Path) -> str:
    source = regular_file(source, root)
    destination = output / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return relative.as_posix()


def notice_files(root: Path) -> list[Path]:
    prefixes = ("LICENSE", "LICENCE", "NOTICE", "COPYRIGHT", "COPYING")
    return sorted(
        path for path in root.rglob("*")
        if path.name.upper().startswith(prefixes) and path.is_file()
    )


def dependency_metadata() -> list[dict]:
    packages: dict[str, dict] = {}
    for target in TARGETS:
        metadata = json.loads(command([
            "cargo", "metadata", "--locked", "--offline", "--format-version", "1",
            "--filter-platform", target,
        ]))
        indexed = {package["id"]: package for package in metadata["packages"]}
        nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}
        pending = [metadata["resolve"]["root"]]
        seen = set()
        while pending:
            package_id = pending.pop()
            if package_id in seen:
                continue
            seen.add(package_id)
            for dependency in nodes[package_id]["deps"]:
                if any(kind["kind"] != "dev" for kind in dependency["dep_kinds"]):
                    pending.append(dependency["pkg"])
            package = indexed[package_id]
            if package["source"] is None:
                continue
            if package["source"] not in {
                "registry+https://github.com/rust-lang/crates.io-index",
                "sparse+https://index.crates.io/",
            }:
                raise NoticeError("A non-crates.io dependency requires a separate notice review.")
            if package.get("license") not in SUPPORTED:
                raise NoticeError("An unreviewed dependency license requires a separate notice review.")
            if package["license"] == "MPL-2.0" and (package["name"], package["version"]) != ("option-ext", "0.2.0"):
                raise NoticeError("An additional MPL dependency requires source packaging review.")
            if not re.fullmatch(r"[A-Za-z0-9_.+-]+", package["name"] + package["version"]):
                raise NoticeError("Unexpected dependency package identifier.")
            packages.setdefault(package_id, {**package, "notice_targets": []})["notice_targets"].append(target)
    return sorted(packages.values(), key=lambda package: (package["name"], package["version"]))


def rust_notices(packages: list[dict], output: Path) -> list[dict]:
    entries = []
    for package in packages:
        name, version = package["name"], package["version"]
        root = Path(package["manifest_path"]).parent
        files = notice_files(root)
        if not files:
            raise NoticeError("A dependency has no available license text; review it before release.")
        destination = Path("licenses/rust") / f"{name}-{version}"
        copied = [copy_file(file, root, output, destination / file.relative_to(root)) for file in files]
        entry = {
            "name": name, "version": version, "ecosystem": "cargo",
            "license": package["license"], "targets": package["notice_targets"],
            "source_archive": f"https://crates.io/api/v1/crates/{quote(name)}/{quote(version)}/download",
            "notices": copied,
        }
        if name == "option-ext":
            source_destination = Path("third-party-sources") / f"{name}-{version}"
            # Copy original crate sources only, never .cargo metadata/cache files.
            source_files = [root / value for value in ("Cargo.toml", "Cargo.toml.orig", "README.md", "LICENSE.txt")]
            source_files.extend(sorted((root / "src").rglob("*")))
            for source in source_files:
                if source.is_dir():
                    continue
                copy_file(source, root, output, source_destination / source.relative_to(root))
            entry["included_source"] = source_destination.as_posix()
            entry["source_status"] = "Unmodified upstream source, available under MPL-2.0."
        if name == "libsqlite3-sys":
            header = regular_file(root / "sqlite3/sqlite3.h", root).read_text(encoding="utf-8")
            start = header.split("*************************************************************************", 1)[0]
            if "The author disclaims copyright" not in start:
                raise NoticeError("The bundled SQLite public-domain declaration needs review.")
            relative = destination / "SQLite-public-domain.txt"
            (output / relative).write_text(start + "\n", encoding="utf-8")
            entry["notices"].append(relative.as_posix())
            entry["bundled_sqlite"] = "SQLite upstream public-domain declaration; SQLCipher is not enabled."
        entries.append(entry)
    return entries


def web_notices(output: Path) -> list[dict]:
    lock = json.loads((ROOT / "web/package-lock.json").read_text(encoding="utf-8"))
    entries = []
    for name in ("react", "react-dom", "scheduler", "vite"):
        root = ROOT / "web/node_modules" / name
        installed = json.loads((root / "package.json").read_text(encoding="utf-8"))
        locked = lock["packages"]["node_modules/" + name]
        if installed["version"] != locked["version"] or installed.get("license") != "MIT":
            raise NoticeError("A frontend dependency version or license needs review.")
        source = locked["resolved"]
        url = urlsplit(source)
        if url.scheme != "https" or url.netloc != "registry.npmjs.org":
            raise NoticeError("A frontend source archive URL needs review.")
        file = root / ("LICENSE.md" if name == "vite" else "LICENSE")
        relative = Path("licenses/web") / f"{name}-{installed['version']}" / file.name
        if name == "vite":
            # Only the Vite modulepreload helper is embedded, not the build tool.
            # Preserve its full original core MIT section without rewording it.
            core = regular_file(file, root).read_text(encoding="utf-8").split("# Licenses of bundled dependencies", 1)[0]
            if "MIT License" not in core or "VoidZero" not in core or "Permission is hereby granted" not in core:
                raise NoticeError("The Vite modulepreload core license needs review.")
            (output / relative).parent.mkdir(parents=True, exist_ok=True)
            (output / relative).write_text(core, encoding="utf-8")
        else:
            copy_file(file, root, output, relative)
        entries.append({
            "name": name, "version": installed["version"], "ecosystem": "npm",
            "license": "MIT", "source_archive": source, "notices": [relative.as_posix()],
            "scope": "embedded modulepreload helper" if name == "vite" else "embedded frontend runtime",
        })
    return entries


def standard_library_notices(output: Path) -> dict:
    sysroot = Path(command(["rustc", "--print", "sysroot"]).strip())
    root = sysroot / "share/doc/rust"
    version = command(["rustc", "--version"]).strip()
    copyright_file = root / "COPYRIGHT-library.html"
    copy_file(copyright_file, root, output, Path("licenses/rust-standard-library/COPYRIGHT-library.html"))
    license_directory = root / "licenses"
    if not license_directory.is_dir():
        raise NoticeError("Rust standard-library license texts are unavailable.")
    copied = 0
    for file in sorted(license_directory.rglob("*")):
        if file.is_file():
            copy_file(file, root, output, Path("licenses/rust-standard-library") / file.relative_to(root))
            copied += 1
    if not copied:
        raise NoticeError("Rust standard-library license texts are unavailable.")
    return {"toolchain": version, "notice": "licenses/rust-standard-library/COPYRIGHT-library.html"}


def generate(output: Path) -> dict:
    packages = dependency_metadata()
    # mkdir must fail even for an empty directory or a broken symlink: never
    # merge notices with an existing release, erase it, or overwrite its files.
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir()
    copy_file(ROOT / "LICENSE", ROOT, output, Path("LICENSE"))
    manifest = {
        "schema_version": 1,
        "scope": "Union of Linux/Windows Cargo normal/build dependencies (no dev edges), embedded web runtime and Rust standard library. Build/macro notices are conservatively retained.",
        "dependencies": rust_notices(packages, output) + web_notices(output),
        "rust_standard_library": standard_library_notices(output),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "THIRD_PARTY_NOTICES.txt").write_text(
        "AI Quota third-party software notices\n\n"
        "Keep this file, LICENSE, licenses/, manifest.json, and third-party-sources/ "
        "alongside the distributed executable. Project MIT licensing applies only "
        "to original project code; third-party code retains its own licenses.\n\n"
        "manifest.json lists locked package versions, source archive URLs and full "
        "license/notice paths. This is a conservative union for the Linux and Windows "
        "packages, including build/macro notices; not every entry is embedded in every executable.\n\n"
        "The unmodified option-ext 0.2.0 source is included under "
        "third-party-sources/option-ext-0.2.0/ under MPL-2.0; its license is included there. "
        "Other project code is not relicensed under MPL.\n\n"
        "React, react-dom and scheduler are embedded frontend runtimes. Vite is "
        "listed for its embedded modulepreload helper, not its whole build tool. "
        "SQLite is bundled without SQLCipher; the upstream public-domain declaration "
        "and Rust bindings' license are included. Rust standard-library notices and "
        "their relative license texts are included under licenses/rust-standard-library/.\n",
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New output directory; missing parents are created")
    args = parser.parse_args()
    try:
        manifest = generate(args.output)
    except NoticeError as error:
        print(f"Notice packaging failed: {error} Output, if created, is incomplete; do not publish it.", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        print("Notice packaging failed: unavailable inputs or output directory already exists. Output, if created, is incomplete; do not publish it.", file=sys.stderr)
        return 1
    print(f"Packaged notices for {len(manifest['dependencies'])} locked dependencies plus the Rust standard library.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
