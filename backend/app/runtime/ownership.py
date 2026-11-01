"""Explicit account identifiers for session and background boundaries."""

from typing import Any


class TenantScopeError(RuntimeError):
    """Raised when an ORM write crosses the account bound to its session."""


def require_owner_id(value: object, *, subject: str = "resource") -> str:
    owner_user_id = str(value or "").strip()
    if not owner_user_id:
        raise TenantScopeError(f"{subject} is missing account ownership")
    return owner_user_id


def bind_owner(session: Any, owner_user_id: str) -> None:
    session.info["owner_user_id"] = require_owner_id(owner_user_id, subject="database session")
