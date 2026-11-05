"""Build and replace the single frontend served by both website listeners."""

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CURRENT = Path(".local/studio-current/current")

BACKEND = str(ROOT / "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from studio.runtime.http.website_releases import retired_releases  # noqa: E402


def uses_shared_frontend(root=ROOT):
    config = tomllib.loads((root / "backend/config.toml").read_text())
    configured = Path(config.get("website", {}).get("web_root", ""))
    return root / configured == root / CURRENT


def verified_build(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    build = manifest["build_id"]
    files = manifest["files"]
    names = set()
    for entry in files:
        path = directory / entry["path"]
        if not path.resolve().is_relative_to(directory) or path.is_symlink():
            raise ValueError("构建清单包含不安全路径")
        data = path.read_bytes()
        if (
            entry["path"] in names
            or len(data) != entry["bytes"]
            or (hashlib.sha256(data).hexdigest() != entry["sha256"])
        ):
            raise ValueError("构建清单校验失败")
        names.add(entry["path"])
    canonical = json.dumps(
        [entry for entry in files if entry["path"] != "build.json"],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    if (
        not {"index.html", "build.json"} <= names
        or not re.fullmatch(r"[a-f0-9]{64}", build)
        or hashlib.sha256(canonical).hexdigest() != build
        or json.loads((directory / "build.json").read_text())["build_id"] != build
    ):
        raise ValueError("构建标识校验失败")
    # Do not publish Vite's internal manifest or files outside the release manifest.
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise ValueError("构建不能包含符号链接")
        if path.is_file() and path.relative_to(directory).as_posix() not in names | {
            "manifest.json"
        }:
            path.unlink()
    return build


def rebuild(root):
    current = root / CURRENT
    builds = current.parent / "builds"
    builds.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".staging-", dir=current.parent) as temporary:
        stage = Path(temporary) / "web"
        result = subprocess.run(
            ["npm", "run", "build:studio"],
            cwd=root,
            env={
                **os.environ,
                "FPL_WEB_DIST_DIR": str(stage),
                "FPL_STUDIO_PRECOMPRESS": "0",
                "VITE_API_BASE": "",
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        if result.returncode:
            print(result.stdout[-12_000:], flush=True)
            result.check_returncode()
        build = verified_build(stage)
        target = builds / build
        if not target.exists():
            stage.rename(target)
        previous = current.resolve() if current.is_symlink() else None
        link = Path(temporary) / "current"
        link.symlink_to(target.relative_to(current.parent), target_is_directory=True)
        retired = current.parent / "retired"
        retired.mkdir(exist_ok=True)
        if previous != target and previous is not None and previous.parent == builds:
            (retired / previous.name).touch()
        link.replace(current)
        (retired / target.name).unlink(missing_ok=True)
        print(f"Studio 构建已切换：{build}", flush=True)


def source_snapshot(root):
    paths = [
        root / name
        for name in (
            "package.json",
            "package-lock.json",
            "scripts/check_lfs_assets.py",
            "scripts/generate_image_variants.py",
        )
    ]
    paths.extend((root / "web").glob("*.*"))
    for directory in ("web/src", "web/public", "web/scripts"):
        paths.extend((root / directory).rglob("*"))
    result = {}
    for path in paths:
        try:
            if path.is_file() and not path.name.endswith(".tsbuildinfo"):
                stat = path.stat()
                result[path] = (stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            continue
    return result


def prune(root):
    current = root / CURRENT
    active = current.resolve()
    _, expired = retired_releases(active, current.parent / "builds")
    for path in expired:
        # Eviction is permanent even if an in-flight response delays deletion.
        (current.parent / "retired" / path.name).unlink(missing_ok=True)
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except FileNotFoundError:
            continue
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            if path != current.resolve():
                shutil.rmtree(path)
        finally:
            os.close(descriptor)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    state = ROOT / CURRENT.parent
    state.mkdir(parents=True, exist_ok=True)
    with (state / "builder.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for stage in state.glob(".staging-*"):
            if stage.is_dir() and not stage.is_symlink():
                shutil.rmtree(stage)
        run(args.watch)


def run(watch):
    if not watch:
        rebuild(ROOT)
        prune(ROOT)
        return
    observed = None
    while True:
        snapshot = source_snapshot(ROOT)
        if snapshot != observed:
            time.sleep(0.75)
            if snapshot != source_snapshot(ROOT):
                continue
            observed = snapshot
            try:
                rebuild(ROOT)
            except (subprocess.CalledProcessError, OSError, ValueError, KeyError) as error:
                print(f"Studio 构建失败，继续使用当前版本：{error}", flush=True)
        if (ROOT / CURRENT).is_symlink():
            prune(ROOT)
        time.sleep(1)


if __name__ == "__main__":
    main()
