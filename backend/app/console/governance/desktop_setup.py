"""First-account bootstrap under an exclusive SQLite writer transaction."""

from sqlalchemy import select, text

from app.console.governance.provisioning import create_account
from app.console.models import User


class DesktopAlreadyInitialized(Exception):
    pass


async def setup_required(session) -> bool:
    return await session.scalar(select(User.id).limit(1)) is None


async def setup_account(session, *, username: str, display_name: str, password: str) -> None:
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    try:
        if not await setup_required(session):
            raise DesktopAlreadyInitialized
        await create_account(
            session,
            username=username,
            display_name=display_name,
            password=password,
            is_platform_admin=True,
            client_ip="127.0.0.1",
        )
    except Exception:
        await session.rollback()
        raise
