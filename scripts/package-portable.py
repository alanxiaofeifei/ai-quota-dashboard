#!/usr/bin/env python3
"""Prepare new portable bundles from built binaries and committed-source metadata."""
import argparse
import hashlib
import json
import re
import shutil
import sys
import tomllib
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent


class PackageError(Exception):
    pass


def regular(path: Path, root: Path) -> Path:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise PackageError("package_symlink_rejected")
    if not path.is_file():
        raise PackageError("package_input_unavailable")
    return path


def copy_tree(source: Path, destination: Path) -> None:
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise PackageError("package_symlink_rejected")
        if path.is_file():
            regular(path, source)
    shutil.copytree(source, destination)


def prepare(root: Path, notices: Path, source_manifest: Path, output: Path, platform: str) -> None:
    if output.exists() or output.is_symlink():
        raise PackageError("package_output_exists")
    manifest = json.loads(regular(source_manifest, root).read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("functional_source_sha256", "")):
        raise PackageError("package_source_manifest_invalid")
    files = manifest.get("files")
    if not isinstance(files, list):
        raise PackageError("package_source_manifest_invalid")
    extension = []
    seen = set()
    for entry in files:
        value = entry.get("path", "")
        if not value.startswith("browser-extension/"):
            continue
        path = PurePosixPath(value)
        if "\\" in value or path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")) or value in seen:
            raise PackageError("package_source_manifest_invalid")
        source = regular(root / path, root)
        if hashlib.sha256(source.read_bytes()).hexdigest() != entry.get("sha256"):
            raise PackageError("package_extension_source_mismatch")
        seen.add(value)
        extension.append((path, source))
    if "browser-extension/manifest.json" not in seen:
        raise PackageError("package_extension_missing")
    extension_manifest = json.loads((root / "browser-extension/manifest.json").read_text(encoding="utf-8"))
    if extension_manifest.get("manifest_version") != 3 or not extension_manifest.get("name"):
        raise PackageError("package_extension_invalid")
    if (notices / "manifest.json").exists():
        raise PackageError("package_ambiguous_manifest_rejected")
    for name in ("LICENSE", "THIRD_PARTY_MANIFEST.json", "THIRD_PARTY_NOTICES.txt"):
        regular(notices / name, notices)
    suffix = ".exe" if platform == "win32" else ""
    binaries = {name: regular(root / "target/release" / (name + suffix), root)
                for name in ("ai-quota-preflight", "ai-quota-dashboard")}
    version = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    guide = f"""Quota AI {version} — 从这里开始

请将新版解压到新目录；升级时先退出旧程序，再运行新版，不要混合新旧程序包的文件。

1. 双击 ai-quota-dashboard{suffix}，保留程序窗口；它打开的 127.0.0.1 是本机网站。
   这不是已发布的 ChatGPT Sites 或 GitHub Pages 网站，电脑关机后本机服务停止。
2. Chrome/Edge → 扩展 → 开发者模式 → 加载已解压的扩展。
   请选择本包里的 browser-extension 子目录，不要选择 exe 所在的根目录。
   只有 browser-extension/manifest.json 是浏览器扩展清单；其他清单是版本/许可记录。
   已安装旧版 AI Quota 扩展时，移除旧版后加载新版 browser-extension 目录，避免选错版本。
3. 在看板创建本地账户别名（只是归档名称，不是平台登录）。
4. 打开 https://chatgpt.com/settings/usage?tab=overview 并手动刷新。
   选中 Weekly limit 和 Credits 的数字余额，点击扩展读取并核对。
5. 点击扩展“复制摘要”，回到看板“粘贴摘要”导入；也可以下载 JSON 后选择“导入网页摘要”。
   复制不可用时按扩展提示手动复制文本。不要导入本包的许可或源码清单。

“重载本机记录”不会刷新平台额度。更新时应重新读取官方页面，再复制/导入。
credits 未选中时保持未知；超过 15 分钟显示过期。预计重置到点不会变成已恢复。
数据库仍保存在当前用户的本地应用数据目录；换新版 exe 不会自动删除已有数据。
升级前退出旧程序并备份数据目录；无需修改官方客户端、账号或浏览器登录配置。

本包含项目和第三方许可、适用的第三方源码、SOURCE_MANIFEST.json 源码指纹及 SHA256SUMS 程序哈希。
请保留许可和源码附件，重新分发时一并提供。
"""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir()
    for name, binary in binaries.items():
        destination = output / name
        copy_tree(notices, destination)
        shutil.copy2(binary, destination)
        shutil.copy2(source_manifest, destination / "SOURCE_MANIFEST.json")
        digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        (destination / "SHA256SUMS").write_text(f"{digest}  {binary.name}\n", encoding="utf-8")
        if name == "ai-quota-dashboard":
            for path, source in extension:
                target = destination / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            shutil.copy2(root / "LICENSE", destination / "browser-extension/LICENSE")
            (destination / "START-HERE.txt").write_text(guide, encoding="utf-8")
    destination = output / "quota-usage-selection-validator"
    destination.mkdir()
    for path, source in extension:
        target = destination / path.relative_to("browser-extension")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    shutil.copy2(root / "LICENSE", destination / "LICENSE")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notices", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        prepare(ROOT, arguments.notices.resolve(), arguments.source_manifest.resolve(), arguments.output, sys.platform)
    except PackageError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print("portable_package_inputs_unavailable", file=sys.stderr)
        return 1
    print("Prepared portable programs and the correctly separated browser extension.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
