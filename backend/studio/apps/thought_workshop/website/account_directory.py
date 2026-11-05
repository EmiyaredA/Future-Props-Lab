"""Minimal public account values supplied explicitly by Identity or the recovery adapter."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from studio.apps.thought_workshop.errors import ThoughtError
from studio.contracts.identity.account_directory import AccountProfile


class AccountDirectory(Protocol):
    async def profiles(self, *, ids=(), usernames=()) -> list[AccountProfile]: ...
    async def current(self, principal): ...
    def for_session(self, session): ...


@dataclass(frozen=True)
class DirectoryBindings:
    for_request: Callable


def directory(session) -> AccountDirectory:
    value = session.info.get("thought_directory")
    if value is None:
        factory = session.info.get("thought_directory_factory")
        if factory is None:
            raise ThoughtError("账号目录尚未连接", 503, "account_directory_unavailable")
        value = factory(session)
    return value.for_session(session)


async def profiles(session, *, ids=(), usernames=()):
    if not ids and not usernames:
        return []
    return await directory(session).profiles(ids=ids, usernames=usernames)


async def author(session, user_id):
    if not user_id:
        return None
    return next(iter(await profiles(session, ids=(user_id,))), None)
