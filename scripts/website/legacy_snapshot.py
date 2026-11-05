"""Seal a stopped compatibility website and restore its exact files to a new bundle."""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

from scripts.website.data_transfer import copy_file, copy_tree, locked, verify_database

from db.migrations.registry import MIGRATIONS
from db.migrations.runner import migration_checksum

DATABASE = "future-props.db"
MANIFEST = "manifest.json"
RUNTIME = ".runtime"
CONFIG = Path("backend/config.toml")


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def directory(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError("必须指定真实目录")
    return path.resolve()


def private_config(path):
    info = path.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise ValueError("网站配置必须是当前用户所有的 0600 普通文件")
    return path.resolve()


def runtime_inventory(root):
    records = {}
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in sorted([*dirs, *files]):
            path = Path(base) / name
            key = path.relative_to(root).as_posix()
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                reference = os.readlink(path)
                if (
                    Path(reference).is_absolute()
                    or not path.resolve().is_relative_to(root)
                    or not path.exists()
                ):
                    raise ValueError(f"运行目录包含外部或失效链接 {key}")
                records[key] = {"link": reference}
            elif stat.S_ISDIR(mode):
                records[key] = {"directory": True, "mode": stat.S_IMODE(mode)}
            elif stat.S_ISREG(mode):
                records[key] = {
                    "sha256": digest(path),
                    "bytes": path.stat().st_size,
                    "mode": stat.S_IMODE(mode),
                }
            elif not (stat.S_ISSOCK(mode) and key.startswith("agent/")):
                raise ValueError(f"运行目录包含未登记的特殊文件 {key}")
    return records


def manifest(runtime, config, revision):
    database = runtime / DATABASE
    if database.is_symlink() or not database.is_file():
        raise ValueError("正式网站数据库缺失")
    migrations = verify_database(
        database,
        expected_migrations=[(item.migration_id, migration_checksum(item)) for item in MIGRATIONS],
    )
    return {
        "version": 1,
        "source_revision": revision,
        "runtime_mode": stat.S_IMODE(runtime.stat().st_mode),
        "files": runtime_inventory(runtime),
        "config_sha256": digest(config),
        "database_migrations": migrations,
    }


def assert_stopped(database):
    executable = shutil.which("lsof")
    if executable is None:
        raise ValueError("缺少 lsof，无法核验旧站停机")
    result = subprocess.run([executable, "-t", str(database)], capture_output=True, check=False)
    if result.stdout.strip() or result.returncode != 1 or result.stderr.strip():
        raise ValueError("网站数据库仍被占用或无法核验")


def fsync_bundle(root):
    for directory_path, _dirs, files in os.walk(root, topdown=False, followlinks=False):
        for path in [*(Path(directory_path) / name for name in files), Path(directory_path)]:
            if path.is_symlink():
                continue
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)


@contextmanager
def publish_to(target):
    if target.is_symlink() or target.exists():
        raise ValueError("恢复产物目标必须为空路径")
    parent = directory(target.parent)
    target = parent / target.name
    lock = parent / f".{target.name}.publish.lock"
    if lock.is_symlink() or (lock.exists() and not lock.is_file()):
        raise ValueError("恢复产物锁文件无效")
    with locked(lock):
        if target.is_symlink() or target.exists():
            raise ValueError("恢复产物目标已经存在")
        stage = Path(tempfile.mkdtemp(prefix=f".{target.name}.pending-", dir=parent))
        try:
            yield stage
            fsync_bundle(stage)
            if target.is_symlink() or target.exists():
                raise ValueError("恢复产物目标已经存在")
            os.rename(stage, target)
            descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def copy_contents(runtime, config, target):
    copy_tree(runtime, target / RUNTIME)
    (target / CONFIG.parent).mkdir(mode=0o700)
    copy_file(config, target / CONFIG)


def revision_id(revision):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("源提交必须为完整 Git SHA")
    return revision


def create(runtime, config, output, revision):
    from app.runtime.config import Settings
    from fpl_config import read_config

    revision_id(revision)
    runtime, config = directory(runtime), private_config(config)
    destination = output.resolve()
    if destination.is_relative_to(runtime) or runtime.is_relative_to(destination):
        raise ValueError("快照目标与运行目录必须隔离")
    if Settings.validate_file_values(read_config(config)).database_path != runtime / DATABASE:
        raise ValueError("网站配置与指定源数据库不一致")
    lock = runtime / "website.lock"
    if lock.is_symlink() or (lock.exists() and not lock.is_file()):
        raise ValueError("网站锁文件无效")
    with locked(lock):
        assert_stopped(runtime / DATABASE)
        original = manifest(runtime, config, revision)
        with publish_to(output) as stage:
            copy_contents(runtime, config, stage)
            if manifest(stage / RUNTIME, stage / CONFIG, revision) != original:
                raise ValueError("快照文件与源目录不一致")
            if manifest(runtime, config, revision) != original:
                raise ValueError("复制期间源运行文件发生变化")
            report = stage / MANIFEST
            report.touch(mode=0o600)
            report.write_text(json.dumps(original, ensure_ascii=False, sort_keys=True) + "\n")
            seal = digest(report)
    return {"source_revision": revision, "manifest_sha256": seal, "files": len(original["files"])}


def restore(snapshot, target, revision, seal):
    revision_id(revision)
    snapshot = directory(snapshot)
    destination = target.resolve()
    if destination.is_relative_to(snapshot) or snapshot.is_relative_to(destination):
        raise ValueError("恢复目标与快照必须隔离")
    record = snapshot / MANIFEST
    if not re.fullmatch(r"[a-f0-9]{64}", seal) or digest(private_config(record)) != seal:
        raise ValueError("快照清单摘要不符")
    expected = json.loads(record.read_text())
    if expected.get("source_revision") != revision:
        raise ValueError("快照与旧站提交版本不符")
    runtime, config = directory(snapshot / RUNTIME), private_config(snapshot / CONFIG)
    if manifest(runtime, config, revision) != expected:
        raise ValueError("快照文件验证失败")
    with publish_to(target) as stage:
        copy_contents(runtime, config, stage)
        if manifest(stage / RUNTIME, stage / CONFIG, revision) != expected:
            raise ValueError("恢复目录验证失败")
        if manifest(runtime, config, revision) != expected:
            raise ValueError("恢复过程中快照发生变化")
    return {"source_revision": revision, "manifest_sha256": seal, "files": len(expected["files"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    seal = commands.add_parser("create")
    seal.add_argument("--runtime", type=Path, required=True)
    seal.add_argument("--config", type=Path, required=True)
    seal.add_argument("--output", type=Path, required=True)
    recover = commands.add_parser("restore")
    recover.add_argument("--snapshot", type=Path, required=True)
    recover.add_argument("--target", type=Path, required=True)
    recover.add_argument("--manifest-sha256", required=True)
    for command in (seal, recover):
        command.add_argument("--source-revision", required=True)
    options = parser.parse_args()
    try:
        if options.command == "create":
            result = create(
                options.runtime, options.config, options.output, options.source_revision
            )
        else:
            result = restore(
                options.snapshot, options.target, options.source_revision, options.manifest_sha256
            )
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"{exc}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
