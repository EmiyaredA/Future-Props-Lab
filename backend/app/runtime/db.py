from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from studio.config.settings import get_settings

settings = get_settings()
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False},
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.close()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def close_website_database() -> None:
    """Settle committed WAL frames after background writers and HTTP requests stop."""
    try:
        async with engine.connect() as connection:
            result = (await connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")).one()
            if result[0] != 0:
                raise RuntimeError("网站停机时数据库仍被占用，无法结算 WAL")
    finally:
        await engine.dispose()
