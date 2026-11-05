"""Offline file relocation with a complete recovery snapshot and read-only SQLite checks.

This tool never edits SQLite data or schema. Run only after the source host has stopped.
"""

import argparse
import contextlib
import ctypes
import fcntl
import hashlib
import json
import os
import shutil
import sqlite3
import stat
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def inventory(root):
    rows = {}
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in [*directories, *files]:
            path = Path(parent) / name
            relative = path.relative_to(root).as_posix()
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                rows[relative] = {"link": os.readlink(path)}
            elif stat.S_ISREG(info.st_mode):
                rows[relative] = {"size": info.st_size, "sha256": digest(path)}
            elif not stat.S_ISDIR(info.st_mode):
                # Old native IPC sockets have no persistent business content.
                if relative.startswith("agent/") and stat.S_ISSOCK(info.st_mode):
                    continue
                raise ValueError(f"Unsupported special file: {relative}")
    return rows


def copy_file(source, target):
    # APFS clone avoids allocating another full copy of large immutable media.
    # A normal copy remains the portable fallback; every result is hashed later.
    if sys.platform == "darwin":
        library = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        if library.clonefile(os.fsencode(source), os.fsencode(target), 0) == 0:
            shutil.copystat(source, target)
            return str(target)
    return shutil.copy2(source, target)


def copy_tree(source, target):
    def ignore(parent, names):
        return [name for name in names if stat.S_ISSOCK((Path(parent) / name).lstat().st_mode)]

    shutil.copytree(source, target, symlinks=True, copy_function=copy_file, ignore=ignore)


def verify_database(path, *, expected_migrations=None):
    wal = path.with_name(path.name + "-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError("SQLite 仍有未结算 WAL，请正常停止应用后重试；迁移工具不写数据库")
    with contextlib.closing(
        sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    ) as database:
        if database.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed")
        if database.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("SQLite foreign key check failed")
        ledger = database.execute(
            "SELECT migration_id, checksum FROM schema_migrations ORDER BY rowid"
        ).fetchall()
        if expected_migrations is not None and ledger != expected_migrations:
            raise ValueError("网站迁移注册表与源版本不一致")
        return [row[0] for row in ledger]


def locked(path):
    @contextlib.contextmanager
    def hold():
        with path.open("a") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("数据仍被运行实例占用，请先正常停止") from None
            yield

    return hold()


def transfer(source, project, report_dir):
    from cryptography.fernet import Fernet

    from studio.config.migration import encode

    source, project, report_dir = source.resolve(), project.resolve(), report_dir.resolve()
    if source == project or source in project.parents or project in source.parents:
        raise ValueError("源数据和项目必须为独立目录")
    config_source = source / "backend/config.toml"
    if not (source / "runtime/future-props.db").is_file() or not config_source.is_file():
        raise ValueError("正式桌面数据或原配置缺失，拒绝初始化替代数据库")
    document = tomllib.loads(config_source.read_text())
    key = document.get("security", {}).get("secrets_key")
    if not key:
        raise ValueError("正式加密密钥缺失，拒绝生成替代密钥")
    Fernet(key.encode())
    report_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    with locked(source / "backend.lock"):
        old_runtime = project / ".runtime"
        with contextlib.ExitStack() as stack:
            if old_runtime.exists():
                stack.enter_context(locked(old_runtime / "website.lock"))
            # Open database handles are checked separately from the product lock.
            import subprocess

            executable = shutil.which("lsof")
            if executable:
                probe = subprocess.run(
                    [executable, "-t", str(source / "runtime/future-props.db")], capture_output=True
                )
                if probe.stdout.strip():
                    raise ValueError("正式数据库仍有打开的进程，拒绝复制")
            elif sys.platform == "darwin":
                raise ValueError("缺少 lsof，无法核验正式数据库停机状态")
            print("Hashing the stopped authoritative source", flush=True)
            before = inventory(source)
            schema = verify_database(source / "runtime/future-props.db")
            snapshot = report_dir / "desktop-snapshot"
            copy_tree(source, snapshot)
            if inventory(snapshot) != before or inventory(source) != before:
                raise ValueError("源数据发生变化或停机快照校验失败")
            verify_database(snapshot / "runtime/future-props.db")
            (report_dir / "snapshot-manifest.json").write_text(
                json.dumps(before, ensure_ascii=False)
            )
            print("Full recovery snapshot verified; preparing project data", flush=True)
            stage = report_dir / "runtime-stage"
            copy_tree(snapshot / "runtime", stage)
            for name in ["local-models", "agent"]:
                if (snapshot / name).exists():
                    if (stage / name).exists():
                        raise ValueError(f"目标目录冲突：{name}")
                    copy_tree(snapshot / name, stage / name)
                    if inventory(snapshot / name) != inventory(stage / name):
                        raise ValueError(f"附属数据校验失败：{name}")
            runtime_manifest = {
                k.removeprefix("runtime/"): v for k, v in before.items() if k.startswith("runtime/")
            }
            actual = {
                k: v
                for k, v in inventory(stage).items()
                if not k.startswith(("local-models/", "agent/"))
            }
            if actual != runtime_manifest:
                raise ValueError("正式运行文件迁移校验失败")
            verify_database(stage / "future-props.db")
            document.setdefault("storage", {})["database_path"] = ".runtime/future-props.db"
            document["website"] = {
                "port": 9000,
                "web_root": ".local/studio-release",
                "public_enabled": False,
                "legacy_data_root": str(source),
            }
            document.setdefault("remote_web", {})["web_root"] = str(
                project / ".local/studio-release"
            )
            config_target = project / "backend/config.toml"
            config_stage = report_dir / "website-config.toml"
            config_stage.write_text(encode(document))
            config_stage.chmod(0o600)
            from studio.config import read_config
            from studio.config.settings import Settings

            Settings.validate_file_values(read_config(config_stage))
            # The encryption key must remain byte-for-byte identical after re-encoding.
            if tomllib.loads(config_stage.read_text())["security"]["secrets_key"] != key:
                raise ValueError("加密密钥变化，拒绝发布")
            if config_target.exists():
                copy_file(config_target, report_dir / "project-config-before.toml")
            if old_runtime.exists():
                old_runtime.rename(report_dir / "project-runtime-before")
            try:
                stage.rename(old_runtime)
                old_runtime.chmod(0o700)
                credential_source = snapshot / "backend/web-access"
                credential_target = project / "backend/web-access"
                if credential_target.exists():
                    credential_target.rename(report_dir / "project-web-access-before")
                if credential_source.exists():
                    copy_tree(credential_source, credential_target)
                    if inventory(credential_source) != inventory(credential_target):
                        raise ValueError("网关凭据复制校验失败")
                temporary = config_target.with_name(".website-config.tmp")
                copy_file(config_stage, temporary)
                temporary.chmod(0o600)
                os.replace(temporary, config_target)
            except BaseException:
                if old_runtime.exists():
                    old_runtime.rename(report_dir / "runtime-publish-failed")
                if (report_dir / "project-runtime-before").exists():
                    (report_dir / "project-runtime-before").rename(old_runtime)
                if (report_dir / "project-config-before.toml").exists():
                    shutil.copy2(report_dir / "project-config-before.toml", config_target)
                else:
                    config_target.unlink(missing_ok=True)
                if credential_target.exists():
                    credential_target.rename(report_dir / "web-access-publish-failed")
                if (report_dir / "project-web-access-before").exists():
                    (report_dir / "project-web-access-before").rename(credential_target)
                raise
            result = {
                "source": str(source),
                "target": str(old_runtime),
                "snapshot": str(snapshot),
                "files_verified": len(before),
                "bytes_verified": sum(v.get("size", 0) for v in before.values()),
                "last_migration": schema[-1],
                "original_source_preserved": True,
                "public_enabled": False,
            }
            (report_dir / "result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2)
            )
            print(json.dumps(result, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--report-dir", type=Path, required=True)
    args = parser.parse_args()
    transfer(args.source, args.project, args.report_dir)


if __name__ == "__main__":
    main()
