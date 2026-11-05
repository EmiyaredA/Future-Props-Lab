"""Explicit SQLite handle; importing this module never constructs an engine."""

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


class WebsiteDatabase:
    def __init__(self, database_url, *, session_class):
        self.engine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False},
        )
        self.sessions = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            sync_session_class=session_class,
            expire_on_commit=False,
        )
        event.listen(self.engine.sync_engine, "connect", configure_sqlite_connection)

    async def close(self):
        """Checkpoint after writers stop; always release the engine on failure."""
        try:
            async with self.engine.connect() as connection:
                result = (await connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")).one()
                if result[0] != 0:
                    raise RuntimeError("网站停机时数据库仍被占用，无法结算 WAL")
        finally:
            await self.engine.dispose()


def configure_sqlite_connection(connection, _record):
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.close()
