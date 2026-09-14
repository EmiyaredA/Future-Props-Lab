"""Development data lease, read-only preflight and recoverable offline backups."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))


def verify_lease(root: Path, fd: int):
    expected = (root / "backend.lock").stat()
    actual = os.fstat(fd)
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
        raise ValueError("开发数据锁不匹配")
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def check_data(root: Path, live: bool = False) -> None:
    from app.core.config import Settings
    from db.migrations.registry import MIGRATIONS
    from db.migrations.runner import migration_checksum
    from fpl_config import read_config

    config = root / "backend/config.toml"
    if config.exists():
        values = read_config(config)
        Settings.validate_file_values(values)
        if (root / "runtime/future-props.db").exists() and not values.get("fpl_secrets_key"):
            raise ValueError("已有数据库缺少加密密钥，请恢复原配置")
        last = root / "development/last-success-config.toml"
        if last.exists() and read_config(last).get("fpl_secrets_key") != values.get(
            "fpl_secrets_key"
        ):
            raise ValueError("开发更新不能更换已有数据的加密密钥，请恢复原配置")
    elif live or (root / "runtime/future-props.db").exists():
        raise ValueError("请先恢复或转换 backend/config.toml")
    database = root / "runtime/future-props.db"
    if not database.exists():
        if live:
            raise ValueError("正式数据目录中没有数据库")
        return
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        connection.execute("PRAGMA query_only=ON")
        try:
            applied = connection.execute(
                "SELECT migration_id, checksum FROM schema_migrations ORDER BY rowid"
            ).fetchall()
        except sqlite3.Error:
            raise ValueError("无法核验迁移记录，已阻止开发更新") from None
    expected = [(item.migration_id, migration_checksum(item)) for item in MIGRATIONS]
    if applied != expected:
        raise ValueError("存在待执行迁移或校验和漂移；请先完成隔离验证及正式迁移流程")


def remember_config(root: Path, expected_digest: str | None = None) -> None:
    directory = root / "development"
    directory.mkdir(mode=0o700, exist_ok=True)
    source = root / "backend/config.toml"
    if source.exists():
        content = source.read_bytes()
        if expected_digest is not None and hashlib.sha256(content).hexdigest() != expected_digest:
            raise ValueError("配置已经改变；保留之前的成功配置，等待下次更新")
        fd, temporary = tempfile.mkstemp(prefix=".config-", dir=directory)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / "last-success-config.toml")


def inventory(directory: Path) -> list[dict]:
    rows = []
    for file in sorted(directory.rglob("*")):
        if file.is_symlink():
            raise ValueError("备份包含符号链接，请先核清外部文件依赖")
        if file.is_file():
            with file.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            rows.append(
                {
                    "path": str(file.relative_to(directory)),
                    "bytes": file.stat().st_size,
                    "sha256": digest,
                }
            )
    return rows


def offline_backup(root: Path, *, previous_config: bool = False) -> Path:
    """Caller holds the inherited lease and has stopped its backend."""
    destination = Path(
        tempfile.mkdtemp(
            prefix=f"{root.name} Development Backup {datetime.now():%Y%m%d-%H%M%S}-",
            dir=root.parent,
        )
    )
    try:
        if (root / "runtime").is_symlink() or (root / "backend").is_symlink():
            raise ValueError("备份包含符号链接，请先核清外部文件依赖")
        source_inventory = inventory(root / "runtime")
        config_inventory = inventory(root / "backend")
        for name in ("runtime", "backend"):
            source = root / name
            if not source.exists():
                continue
            target = destination / name
            # APFS copy-on-write clone keeps full snapshots cheap on this Mac.
            cloned = (
                sys.platform == "darwin"
                and subprocess.run(
                    ["/bin/cp", "-cRp", str(source), str(target)], capture_output=True
                ).returncode
                == 0
            )
            if not cloned:
                required = sum(item["bytes"] for item in source_inventory)
                if shutil.disk_usage(destination).free < required + 1024**3:
                    raise ValueError("备份磁盘空间不足；当前数据保持原位")
                shutil.copytree(source, target, dirs_exist_ok=True)
        if inventory(destination / "runtime") != source_inventory:
            raise ValueError("备份文件校验失败，已保留现场")
        if inventory(destination / "backend") != config_inventory:
            raise ValueError("备份配置校验失败，已保留现场")
        last = root / "development/last-success-config.toml"
        if previous_config and last.exists():
            shutil.copyfile(last, destination / "backend/config.toml")
        for file in (destination / "backend").rglob("*"):
            os.chmod(file, 0o700 if file.is_dir() else 0o600)
        database = destination / "runtime/future-props.db"
        if database.exists():
            # SQLite may create SHM/WAL even for mode=ro. Never mutate the verified snapshot.
            with tempfile.TemporaryDirectory(prefix="fpl-backup-check-") as temporary:
                probe = Path(temporary) / database.name
                for suffix in ("", "-wal", "-shm", "-journal"):
                    source = database.with_name(database.name + suffix)
                    if source.exists():
                        shutil.copyfile(source, probe.with_name(probe.name + suffix))
                with closing(sqlite3.connect(probe.as_uri() + "?mode=ro", uri=True)) as connection:
                    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                        raise ValueError("备份数据库完整性检查失败")
                    if connection.execute("PRAGMA foreign_key_check").fetchall():
                        raise ValueError("备份数据库外键检查失败")
        (destination / "manifest.json").write_text(json.dumps(source_inventory, indent=2) + "\n")
        (destination / "config-manifest.json").write_text(
            json.dumps(inventory(destination / "backend"), indent=2) + "\n"
        )
        (destination / "complete.json").write_text(
            json.dumps(
                {
                    "source": str(root),
                    "files": len(source_inventory),
                    "bytes": sum(item["bytes"] for item in source_inventory),
                    "previous_config": previous_config,
                }
            )
            + "\n"
        )
    except Exception:
        print(f"备份尚未完成，现场保留于：{destination}", file=sys.stderr)
        raise
    return destination


def baseline_backup(root: Path) -> None:
    marker = root / "development/baseline.json"
    if marker.exists():
        previous = Path(json.loads(marker.read_text())["backup"])
        if (previous / "complete.json").is_file():
            return
    backup = offline_backup(root)
    marker.parent.mkdir(mode=0o700, exist_ok=True)
    marker.write_text(json.dumps({"backup": str(backup)}) + "\n")
    print(f"正式数据备份已验证：{backup}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--lock-fd", type=int, required=True)
    parser.add_argument("--config-digest")
    parser.add_argument("action", choices=("check", "backup", "remember"))
    args = parser.parse_args()
    verify_lease(args.data_dir, args.lock_fd)
    if args.action == "remember":
        if not args.config_digest:
            raise ValueError("缺少成功加载配置的摘要")
        remember_config(args.data_dir, args.config_digest)
    else:
        check_data(args.data_dir, args.live)
        if args.action == "backup":
            print(f"配置更新前备份已验证：{offline_backup(args.data_dir, previous_config=True)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            str(error) if isinstance(error, ValueError) else "开发数据检查失败，请检查配置与备份",
            file=sys.stderr,
        )
        sys.exit(1)
