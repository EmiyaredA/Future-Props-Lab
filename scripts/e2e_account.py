"""Create a deterministic account in Playwright's temporary isolated database."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))
os.environ["FPL_STUDIO_TOKEN"] = ""

from db.migrations import apply_migrations  # noqa: E402
from studio.apps.identity.credentials.operations import (  # noqa: E402
    change_password,
    complete_login,
)
from studio.assembly.website.account_provisioning import create_account  # noqa: E402
from studio.assembly.website.models import WebsiteSession  # noqa: E402
from studio.config.settings import get_settings  # noqa: E402
from studio.contracts.identity.principal import StudioPrincipal  # noqa: E402
from studio.runtime.database.website import WebsiteDatabase  # noqa: E402


async def main() -> None:
    password = os.environ.get("FPL_E2E_PASSWORD", "E2E-Password-2026!")
    settings = get_settings()
    apply_migrations(settings.database_path)
    database = WebsiteDatabase(settings.database_url, session_class=WebsiteSession)
    try:
        async with database.sessions() as session:
            user, temporary = await create_account(
                session,
                username="e2e-admin",
                display_name="E2E 管理员",
                is_platform_admin=True,
            )
            result = await complete_login(
                session,
                username=user.username,
                password=temporary,
                client_ip="127.0.0.1",
                user_agent="Playwright bootstrap",
            )
            if result is None:
                raise RuntimeError("failed to bootstrap E2E account")
            _user, auth_session, _token, _csrf = result
            principal = StudioPrincipal(
                user_id=user.id,
                platform_role="admin",
                must_change_password=True,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id=auth_session.id,
                reauthenticated_at=auth_session.reauthenticated_at,
            )
            await change_password(
                session,
                principal,
                current_password=temporary,
                new_password=password,
                client_ip="127.0.0.1",
            )
    finally:
        await database.close()


if __name__ == "__main__":
    asyncio.run(main())
