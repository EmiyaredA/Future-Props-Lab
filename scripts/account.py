from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(BACKEND_ROOT))

# Offline bootstrap must remain usable while the operator is removing the retired token.
os.environ["FPL_STUDIO_TOKEN"] = ""

from sqlalchemy import select  # noqa: E402

from app.capabilities.identity.passwords import normalize_username  # noqa: E402
from app.console.governance.provisioning import create_account  # noqa: E402
from app.console.governance.service import reset_password  # noqa: E402
from app.console.models import User  # noqa: E402
from db.migrations import apply_migrations  # noqa: E402
from studio.assembly.website.models import WebsiteSession  # noqa: E402
from studio.config.settings import get_settings  # noqa: E402
from studio.runtime.database.website import WebsiteDatabase  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Future Props Lab 账号引导与离线恢复")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("create-admin", "create-user"):
        command = commands.add_parser(name)
        command.add_argument("--username", required=True)
        command.add_argument("--display-name", default="")
    reset = commands.add_parser("reset-password")
    reset.add_argument("--username", required=True)
    return parser.parse_args()


async def run() -> None:
    args = parse_args()
    settings = get_settings()
    apply_migrations(settings.database_path)
    database = WebsiteDatabase(settings.database_url, session_class=WebsiteSession)
    try:
        async with database.sessions() as session:
            if args.command in {"create-admin", "create-user"}:
                user, temporary = await create_account(
                    session,
                    username=args.username,
                    display_name=args.display_name,
                    is_platform_admin=args.command == "create-admin",
                )
                print(f"账号已创建：{user.username}")
            else:
                normalized = normalize_username(args.username)
                user = await session.scalar(
                    select(User).where(User.username_normalized == normalized)
                )
                if user is None:
                    raise RuntimeError("账号不存在")
                temporary = await reset_password(
                    session,
                    user=user,
                    actor_user_id=None,
                    event_type="account.password_reset.offline",
                )
                print(f"密码已重置：{user.username}")
            print("临时密码（仅显示一次）：")
            print(temporary)
    finally:
        await database.close()


if __name__ == "__main__":
    asyncio.run(run())
