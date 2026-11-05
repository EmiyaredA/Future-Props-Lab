"""The recovery website's explicitly supplied local Identity adapter."""

from dataclasses import replace

from sqlalchemy import or_, select

from studio.apps.identity.storage.models.accounts import User
from studio.apps.thought_workshop.errors import ThoughtError
from studio.contracts.identity.account_directory import AccountProfile
from studio.contracts.identity.usernames import normalize_username


class LegacyAccountDirectory:
    def __init__(self, session):
        self.session = session

    def for_session(self, session):
        return self if session is self.session else LegacyAccountDirectory(session)

    async def current(self, principal):
        user = await self.session.get(User, principal.user_id, populate_existing=True)
        if user is None or user.status != "active":
            raise ThoughtError("内容不存在或不可访问", 404, "not_found")
        return replace(principal, platform_role=user.platform_role)

    async def profiles(self, *, ids=(), usernames=()):
        normalized = [normalize_username(name) for name in usernames]
        rows = await self.session.scalars(
            select(User).where(
                or_(
                    User.id.in_(ids),
                    User.username_normalized.in_(normalized),
                )
            )
        )
        return [
            AccountProfile(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                active=user.status == "active",
            )
            for user in rows
        ]
