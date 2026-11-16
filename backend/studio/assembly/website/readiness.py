"""Database readiness I/O is separate from HTTP probe serialization."""

from sqlalchemy import text

from db.migrations.registry import LATEST_MIGRATION_ID


async def database_schema(database):
    async with database.sessions() as session:
        await session.execute(text("SELECT 1 FROM schema_migrations LIMIT 1"))
        await session.execute(text("SELECT 1 FROM users LIMIT 1"))
    return LATEST_MIGRATION_ID
