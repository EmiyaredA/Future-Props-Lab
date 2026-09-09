from __future__ import annotations

import hashlib
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from dotenv import dotenv_values

from db.migrations.registry import LATEST_MIGRATION_ID, MIGRATIONS, Migration

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


def migration_checksum(migration: Migration | None = None) -> str:
    target = migration or MIGRATIONS[0]
    return hashlib.sha256(target.sql.encode("utf-8")).hexdigest()


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


def migration_state(connection: sqlite3.Connection) -> tuple[list[Migration], list[Migration]]:
    ensure_registry(connection)
    rows = connection.execute(
        # IDs are immutable labels, not sort keys. Timestamp precision is one second;
        # insertion order preserves the registered application sequence across ties.
        "SELECT migration_id, checksum FROM schema_migrations ORDER BY rowid"
    ).fetchall()
    known = {migration.migration_id: migration for migration in MIGRATIONS}
    applied: list[Migration] = []
    for migration_id, checksum in rows:
        migration = known.get(str(migration_id))
        if migration is None:
            raise MigrationDriftError(f"unknown migration: {migration_id}")
        if checksum != migration_checksum(migration):
            raise MigrationDriftError(f"migration checksum drift: {migration_id}")
        applied.append(migration)
    expected_prefix = list(MIGRATIONS[: len(applied)])
    if applied != expected_prefix:
        raise MigrationDriftError("migration registry is not an ordered prefix")
    return applied, list(MIGRATIONS[len(applied) :])


def check_migrations(path: str | Path | None = None) -> str:
    with connect_database(path) as connection:
        _applied, pending = migration_state(connection)
    if pending:
        raise MigrationPendingError(f"pending migration: {pending[0].migration_id}")
    return LATEST_MIGRATION_ID


def apply_migrations(path: str | Path | None = None) -> tuple[str, bool]:
    with connect_database(path) as connection:
        _applied, pending = migration_state(connection)
        if not pending:
            return LATEST_MIGRATION_ID, False
        for migration in pending:
            checksum = migration_checksum(migration)
            try:
                if migration.foreign_keys_off:
                    connection.execute("PRAGMA foreign_keys = OFF")
                connection.executescript("BEGIN IMMEDIATE;\n" + migration.sql)
                connection.execute(
                    "INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)",
                    (migration.migration_id, checksum),
                )
                if migration.foreign_keys_off:
                    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
                    if violations:
                        raise MigrationDriftError(
                            f"foreign key violations after {migration.migration_id}: {violations}"
                        )
                connection.commit()
                if migration.foreign_keys_off:
                    connection.execute("PRAGMA foreign_keys = ON")
            except Exception:
                connection.rollback()
                connection.execute("PRAGMA foreign_keys = ON")
                raise
    return LATEST_MIGRATION_ID, True
