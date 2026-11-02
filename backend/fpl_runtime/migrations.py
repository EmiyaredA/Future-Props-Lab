"""Registered service schemas only. This module never imports application runtime."""

import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Migration:
    id: str
    sql: str

    @property
    def checksum(self):
        return hashlib.sha256(self.sql.encode()).hexdigest()


def check(path: Path, service: str, registry):
    if not path.is_file():
        raise ValueError("服务数据库不存在，必须先显式初始化或导入")
    with sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True) as db:
        rows = db.execute(
            "SELECT service, version, checksum FROM _fpl_service_schema ORDER BY position"
        ).fetchall()
    expected = [(service, item.id, item.checksum) for item in registry]
    if rows != expected:
        raise ValueError("服务迁移缺失、漂移或数据库归属错误")


def apply(path: Path, service: str, registry):
    """Only an explicit maintenance command may invoke this schema migration entry."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_file() and path.stat().st_size:
        with sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True) as existing:
            tables = {
                row[0]
                for row in existing.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if tables and "_fpl_service_schema" not in tables:
                raise ValueError("未登记的旧数据库不能由服务迁移接管")
    db = sqlite3.connect(path)
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("""CREATE TABLE IF NOT EXISTS _fpl_service_schema (
            position INTEGER PRIMARY KEY, service TEXT NOT NULL,
            version TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL)""")
        rows = db.execute(
            "SELECT service, version, checksum FROM _fpl_service_schema ORDER BY position"
        ).fetchall()
        expected = [(service, item.id, item.checksum) for item in registry]
        if rows != expected[: len(rows)] or len(rows) > len(expected):
            raise ValueError("服务迁移历史漂移或数据库归属错误")
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
