"""Registered service schemas only. This module never imports application runtime."""

import hashlib
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Migration:
    id: str
    sql: str

    @property
    def checksum(self):
        return hashlib.sha256(self.sql.encode()).hexdigest()


def _history(db, *, allow_empty=False):
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "_fpl_service_schema" not in tables:
        if allow_empty and not tables:
            return []
        raise ValueError("未登记的旧数据库不能由服务迁移接管")
    return db.execute(
        "SELECT position, service, version, checksum FROM _fpl_service_schema ORDER BY position"
    ).fetchall()


def _validate_prefix(rows, expected):
    if len(rows) > len(expected) or rows != expected[: len(rows)]:
        raise ValueError("服务迁移历史漂移或数据库归属错误")


def _expected(service, registry):
    return [(position, service, item.id, item.checksum) for position, item in enumerate(registry)]


def _read_existing(path, *, allow_empty=False):
    path = path.resolve()
    uri = path.as_uri() + "?mode=ro"
    # A closed, checkpointed WAL database otherwise creates empty WAL/SHM files on read.
    # Existing WAL must use normal SQLite locking and visibility, never immutable mode.
    if not path.with_name(path.name + "-wal").exists():
        uri += "&immutable=1"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        return _history(db, allow_empty=allow_empty)


def check(path: Path, service: str, registry):
    if not path.is_file():
        raise ValueError("服务数据库不存在，必须先显式初始化或导入")
    rows = _read_existing(path)
    if rows != _expected(service, registry):
        raise ValueError("服务迁移缺失、漂移或数据库归属错误")


def apply(path: Path, service: str, registry):
    """Only an explicit maintenance command may invoke this schema migration entry."""
    registry = tuple(registry)
    expected = _expected(service, registry)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_file() and path.stat().st_size:
        _validate_prefix(_read_existing(path, allow_empty=True), expected)
    db = sqlite3.connect(path)
    try:
        rows = _history(db, allow_empty=True)
        _validate_prefix(rows, expected)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("""CREATE TABLE IF NOT EXISTS _fpl_service_schema (
            position INTEGER PRIMARY KEY, service TEXT NOT NULL,
            version TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL)""")
        for position, item in enumerate(registry[len(rows) :], start=len(rows)):
            db.execute("BEGIN IMMEDIATE")
            try:
                # sqlite3.complete_statement respects trigger bodies and SQL strings.
                statement = ""
                for character in item.sql:
                    statement += character
                    if character == ";" and sqlite3.complete_statement(statement):
                        db.execute(statement)
                        statement = ""
                if statement.strip():
                    db.execute(statement)
                db.execute(
                    "INSERT INTO _fpl_service_schema VALUES (?, ?, ?, ?)",
                    (position, service, item.id, item.checksum),
                )
                db.commit()
            except BaseException:
                db.rollback()
                raise
        path.chmod(0o600)
    finally:
        db.close()
