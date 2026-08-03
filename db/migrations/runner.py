from __future__ import annotations

import hashlib
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from dotenv import dotenv_values

from db.migrations.versions.r0001_initial import MIGRATION_ID, SQL

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / "backend" / ".env"
DEFAULT_DATABASE_PATH = REPO_ROOT / ".runtime" / "future-props.db"


class MigrationDriftError(RuntimeError):
    pass


class MigrationPendingError(RuntimeError):
    pass


def resolve_database_path(path: str | Path | None = None) -> Path:
    if path is not None:
        configured = Path(path).expanduser()
    else:
        env = dotenv_values(ENV_FILE)
        raw = os.environ.get("FPL_DATABASE_PATH") or env.get("FPL_DATABASE_PATH")
        configured = Path(str(raw)) if raw else DEFAULT_DATABASE_PATH
        configured = configured.expanduser()
    resolved = configured if configured.is_absolute() else REPO_ROOT / configured
    return resolved.resolve()


def migration_checksum() -> str:
    return hashlib.sha256(SQL.encode("utf-8")).hexdigest()


@contextmanager
def connect_database(path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    database_path = resolve_database_path(path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=5)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        yield connection
    finally:
        connection.close()


def ensure_registry(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          migration_id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.commit()


def migration_state(connection: sqlite3.Connection) -> str:
    ensure_registry(connection)
    row = connection.execute(
        "SELECT checksum FROM schema_migrations WHERE migration_id = ?", (MIGRATION_ID,)
    ).fetchone()
    if row is None:
        return "missing"
    if row[0] != migration_checksum():
        return "drift"
    return "current"


def check_migrations(path: str | Path | None = None) -> str:
    with connect_database(path) as connection:
        state = migration_state(connection)
    if state == "drift":
        raise MigrationDriftError(f"migration checksum drift: {MIGRATION_ID}")
    if state == "missing":
        raise MigrationPendingError(f"pending migration: {MIGRATION_ID}")
    return MIGRATION_ID


def apply_migrations(path: str | Path | None = None) -> tuple[str, bool]:
    with connect_database(path) as connection:
        state = migration_state(connection)
        if state == "drift":
            raise MigrationDriftError(f"migration checksum drift: {MIGRATION_ID}")
        if state == "current":
            return MIGRATION_ID, False
        checksum = migration_checksum()
        try:
            connection.executescript(
                "BEGIN IMMEDIATE;\n"
                + SQL
                + "\nINSERT INTO schema_migrations (migration_id, checksum) VALUES ("
                + f"'{MIGRATION_ID}', '{checksum}');\nCOMMIT;"
            )
        except Exception:
            connection.rollback()
            raise
    return MIGRATION_ID, True
