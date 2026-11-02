"""Service ownership, account isolation and immutable migration checks."""

import sqlite3

import pytest
from sqlalchemy import String, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from fpl_runtime.database import Database, ServiceStorageError
from fpl_runtime.migrations import Migration, apply, check


class Base(DeclarativeBase):
    pass


class Record(Base):
    __tablename__ = "records"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String)
    value: Mapped[str] = mapped_column(String)


class ForeignRecord(Base):
    __tablename__ = "foreign_records"
    id: Mapped[str] = mapped_column(String, primary_key=True)


SCHEMA = (
    Migration(
        "0001",
        "CREATE TABLE records(id TEXT PRIMARY KEY, "
        "owner_user_id TEXT NOT NULL, value TEXT NOT NULL);",
    ),
)


@pytest.mark.asyncio
async def test_independent_service_databases_and_account_scoping(tmp_path):
    first = Database("agents", tmp_path / "agents", models=(Record,))
    second = Database("remote", tmp_path / "remote", models=(Record,))
    for db in (first, second):
        apply(db.path, db.service, SCHEMA)
    try:
        for owner in ("a", "b"):
            async with first.sessions() as session:
                session.info["owner_user_id"] = owner
                session.add(Record(id=owner, value=owner))
                await session.commit()
        async with first.sessions() as session:
            session.info["owner_user_id"] = "a"
            assert [r.value for r in await session.scalars(select(Record))] == ["a"]
            session.add(Record(id="cross", owner_user_id="b", value="bad"))
            with pytest.raises(ServiceStorageError, match="跨账号"):
                await session.commit()
        async with first.sessions() as session:
            session.add(ForeignRecord(id="unowned"))
            with pytest.raises(ServiceStorageError, match="其他服务"):
                await session.commit()
        async with first.sessions() as session:
            with pytest.raises(ServiceStorageError, match="账号上下文"):
                await session.scalars(select(Record))
            with pytest.raises(ServiceStorageError, match="账号上下文"):
                await session.execute(update(Record).values(value="unscoped"))
            session.info["owner_user_id"] = "a"
            with pytest.raises(ServiceStorageError, match="其他服务"):
                await session.scalars(select(ForeignRecord))
        async with second.sessions() as session:
            session.info["owner_user_id"] = "a"
            assert list(await session.scalars(select(Record))) == []
        check(first.path, "agents", SCHEMA)
        with pytest.raises(ValueError):
            check(first.path, "remote", SCHEMA)
    finally:
        await first.close()
        await second.close()


def test_migration_drift_and_unowned_databases_are_rejected_without_writes(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "agents", SCHEMA)
    original = path.read_bytes()
    with pytest.raises(ValueError):
        apply(path, "agents", (Migration("0001", SCHEMA[0].sql + "\n"),))
    assert path.read_bytes() == original
    legacy = tmp_path / "legacy.db"
    with sqlite3.connect(legacy) as db:
        db.execute("CREATE TABLE private_data(id TEXT)")
    before = legacy.read_bytes()
    with pytest.raises(ValueError, match="未登记"):
        apply(legacy, "agents", SCHEMA)
    assert legacy.read_bytes() == before


@pytest.mark.parametrize("problem", ["foreign", "checksum", "position"])
@pytest.mark.parametrize("journal", ["DELETE", "WAL"])
def test_rejected_service_database_keeps_bytes_journal_and_files(tmp_path, problem, journal):
    path = tmp_path / "service.db"
    apply(path, "agents", SCHEMA)
    # This is a temporary fixture, never an application database or a repair command.
    with sqlite3.connect(path) as fixture:
        assert fixture.execute(f"PRAGMA journal_mode={journal}").fetchone() == (journal.lower(),)
        if problem == "position":
            fixture.execute("UPDATE _fpl_service_schema SET position=7")
    fixture.close()
    path.chmod(0o640)
    before = path.read_bytes(), path.stat().st_mode, {p.name for p in tmp_path.iterdir()}
    service = "remote" if problem == "foreign" else "agents"
    registry = (Migration("0001", SCHEMA[0].sql + "\n"),) if problem == "checksum" else SCHEMA
    with pytest.raises(ValueError, match="漂移|归属"):
        check(path, service, registry)
    with pytest.raises(ValueError, match="漂移|归属"):
        apply(path, service, registry)
    assert (path.read_bytes(), path.stat().st_mode, {p.name for p in tmp_path.iterdir()}) == before
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as readonly:
        assert readonly.execute("PRAGMA journal_mode").fetchone() == (journal.lower(),)
    readonly.close()


def test_service_migration_readonly_uri_preserves_literal_path_characters(tmp_path):
    path = tmp_path / "service #1?copy.db"
    apply(path, "agents", SCHEMA)
    check(path, "agents", SCHEMA)
    apply(path, "agents", SCHEMA)
    check(path, "agents", SCHEMA)
    assert {p.name for p in tmp_path.iterdir()} <= {
        path.name,
        path.name + "-wal",
        path.name + "-shm",
    }


def test_migration_rechecks_opened_database_before_writable_setup(tmp_path, monkeypatch):
    path = tmp_path / "service.db"
    apply(path, "agents", SCHEMA)
    connect = sqlite3.connect
    with connect(path) as fixture:
        fixture.execute("PRAGMA journal_mode=DELETE")
    fixture.close()
    observed = []

    def replaced_database(target, *args, **options):
        if target == path:
            # A temporary fixture simulates replacement after the read-only preflight.
            with connect(path) as replacement:
                replacement.execute("UPDATE _fpl_service_schema SET service='remote'")
            replacement.close()
            observed.append(path.read_bytes())
        return connect(target, *args, **options)

    monkeypatch.setattr(sqlite3, "connect", replaced_database)
    with pytest.raises(ValueError, match="归属"):
        apply(path, "agents", SCHEMA)
    assert observed == [path.read_bytes()]
    assert {p.name for p in tmp_path.iterdir()} == {path.name}


def test_readonly_history_observes_existing_wal_without_changing_database_or_commits(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "agents", SCHEMA)
    keeper = sqlite3.connect(path)
    keeper.execute("SELECT * FROM _fpl_service_schema").fetchall()
    second = Migration("0002", "CREATE TABLE second_record(id TEXT PRIMARY KEY);")
    try:
        # The keeper retains the WAL after this temporary fixture's explicit upgrade.
        apply(path, "agents", (*SCHEMA, second))
        wal = path.with_name(path.name + "-wal")
        assert wal.is_file() and wal.stat().st_size > 0
        original = path.read_bytes(), wal.read_bytes()
        check(path, "agents", (*SCHEMA, second))
        alias = tmp_path / "database-alias.db"
        alias.symlink_to(path)
        check(alias, "agents", (*SCHEMA, second))
        with pytest.raises(ValueError, match="漂移"):
            check(path, "agents", SCHEMA)
        with pytest.raises(ValueError, match="归属"):
            apply(path, "remote", (*SCHEMA, second))
        assert (path.read_bytes(), wal.read_bytes()) == original
    finally:
        keeper.close()
