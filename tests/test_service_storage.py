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
