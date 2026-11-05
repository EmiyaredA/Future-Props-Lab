"""Reviewable cleanup limited to reproducible caches and verified duplicate media."""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
PROTECTED = {
    "website-transition",
    "backups",
    "agent-workbench",
    "workshop-retirement",
    "web-access",
    "web-access-release",
    "studio-release",
    "studio-web",
    "account-ownership",
}
CACHES = {"node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", ".vite"}
MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".wav", ".mp3", ".gif", ".pdf", ".pptx"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bytes_under(path):
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file() and not p.is_symlink())


def referenced_sources(root):
    # Read content references from maintained source, never decide from age or filenames alone.
    referenced = set()
    import re

    for directory in [root / "scripts", root / "backend", root / "web/src", root / "docs"]:
        for path in directory.rglob("*"):
            if path.suffix not in {".py", ".ts", ".tsx", ".md", ".json", ".toml"}:
                continue
            for match in re.findall(r"\.local/([A-Za-z0-9_.-]+)", path.read_text(errors="replace")):
                referenced.add(match)
    return referenced


def active_local_roots(root):
    import re

    process = subprocess.run(["ps", "-Ao", "command="], capture_output=True, text=True)
    if process.returncode:
        raise ValueError("无法核验活动任务，暂不生成或执行清理清单")
    pattern = re.escape(str(root / ".local")) + r"/([A-Za-z0-9_.-]+)"
    return set(re.findall(pattern, process.stdout))


def registered_assets(root):
    from app.capabilities.asset_store.storage import AssetStorage
    from studio.config.settings import Settings

    database = root / ".runtime/future-props.db"
    settings = Settings(
        _config_file=root / "backend/config.toml",
        _read_environment=False,
        fpl_database_path=str(database),
    )
    storage = AssetStorage(settings)
    result = {}
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, owner_user_id, storage_key, storage_version, project_id, "
            "galgame_project_id, video_editor_project_id, motion_compositor_project_id "
            "FROM visual_assets"
        )
        for row in rows:
            asset = SimpleNamespace(**dict(row))
            path = storage.path_for(asset)
            if path.is_file() and not path.is_symlink():
                result[path] = {"asset_id": asset.id, "owner_user_id": asset.owner_user_id}
    return result


def plan(root=ROOT):
    local = root / ".local"
    canonical = root / ".runtime/accounts"
    if not canonical.is_dir():
        raise ValueError("先完成正式数据迁移和验收，再核对临时创作副本")
    references = referenced_sources(root) | active_local_roots(root)
    by_size = defaultdict(list)
    assets = registered_assets(root)
    for path in assets:
        if path.is_file() and not path.is_symlink():
            by_size[path.stat().st_size].append(path)
    hashes = {}
    rows = []
    for parent, directories, files in os.walk(local, followlinks=False):
        directory = Path(parent)
        relative = directory.relative_to(local)
        if relative.parts and relative.parts[0] in PROTECTED | references:
            directories[:] = []
            continue
        for name in list(directories):
            candidate = directory / name
            if candidate.is_symlink():
                directories.remove(name)
            elif name in CACHES:
                rows.append(
                    {
                        "path": str(candidate.relative_to(root)),
                        "kind": "cache",
                        "bytes": bytes_under(candidate),
                        "reason": "reproducible dependency/build cache",
                    }
                )
                directories.remove(name)
        for name in files:
            candidate = directory / name
            if candidate.is_symlink() or candidate.suffix.lower() not in MEDIA:
                continue
            size = candidate.stat().st_size
            if size not in by_size:
                continue
            candidate_hash = sha256(candidate)
            for original in by_size[size]:
                if original not in hashes:
                    hashes[original] = sha256(original)
                if hashes[original] == candidate_hash:
                    rows.append(
                        {
                            "path": str(candidate.relative_to(root)),
                            "kind": "duplicate",
                            "bytes": size,
                            "sha256": candidate_hash,
                            "canonical": str(original.relative_to(root)),
                            **assets[original],
                            "reason": "byte-identical registered account asset",
                        }
                    )
                    break
    return {
        "version": 1,
        "root": str(root),
        "protected": sorted(PROTECTED | references),
        "entries": rows,
        "candidate_bytes": sum(row["bytes"] for row in rows),
    }


def apply(manifest, report):
    root = Path(manifest["root"]).resolve()
    if root != ROOT:
        raise ValueError("清单不属于当前项目")
    deleted = []
    active = active_local_roots(root)
    assets = registered_assets(root)
    available_before = shutil.disk_usage(root).free
    for entry in manifest["entries"]:
        path = root / entry["path"]
        if path.is_symlink() or root / ".local" not in path.resolve().parents:
            raise ValueError("非法清理目标")
        if not path.exists():
            continue
        if path.relative_to(root / ".local").parts[0] in set(manifest["protected"]) | active:
            raise ValueError("目标属于保留目录")
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", str(path)], cwd=root, capture_output=True
        )
        if tracked.returncode == 0:
            raise ValueError("不得清理受版本控制文件")
        if entry["kind"] == "duplicate":
            original = root / entry["canonical"]
            if (
                assets.get(original)
                != {"asset_id": entry["asset_id"], "owner_user_id": entry["owner_user_id"]}
                or original.is_symlink()
                or not original.is_file()
                or sha256(original) != entry["sha256"]
                or sha256(path) != entry["sha256"]
            ):
                raise ValueError("正式副本或待删文件已变化，停止清理")
            path.unlink()
        elif entry["kind"] == "cache" and path.name in CACHES:
            shutil.rmtree(path)
        else:
            raise ValueError("未知清理类别")
        deleted.append(entry)
        report.write_text(
            json.dumps(
                {
                    "deleted": deleted,
                    "released_logical_bytes": sum(row["bytes"] for row in deleted),
                    "observed_free_space_change": shutil.disk_usage(root).free - available_before,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    return sum(row["bytes"] for row in deleted)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply:
        print(
            apply(
                json.loads(args.manifest.read_text()),
                args.manifest.with_name("cleanup-result.json"),
            )
        )
    else:
        result = plan()
        args.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(
            json.dumps({"candidates": len(result["entries"]), "bytes": result["candidate_bytes"]})
        )


if __name__ == "__main__":
    main()
