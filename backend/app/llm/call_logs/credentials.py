"""Caller credential snapshots stored on model call logs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.console.models.accounts import ManagementApiKey
from app.runtime.db import SessionLocal

SESSION_AUTH = "session"
MANAGEMENT_API_KEY_AUTH = "management_api_key"
SESSION_FILTER = "session"


class CallerCredential(Protocol):
    """The caller attributes a call log credential snapshot reads."""

    @property
    def auth_kind(self) -> str: ...

    @property
    def api_key_id(self) -> str | None: ...


@dataclass(frozen=True)
class CredentialSnapshot:
    auth_kind: str | None = None
    api_key_id: str | None = None
    api_key_name: str | None = None
    api_key_prefix: str | None = None

    def as_kwargs(self) -> dict[str, str | None]:
        return asdict(self)

    def apply(self, row) -> None:
        for key, value in self.as_kwargs().items():
            setattr(row, key, value)


async def snapshot_from_principal(
    session: AsyncSession, principal: CallerCredential | None
) -> CredentialSnapshot:
    if principal is None:
        return CredentialSnapshot()
    if principal.auth_kind != MANAGEMENT_API_KEY_AUTH or not principal.api_key_id:
        return CredentialSnapshot(auth_kind=SESSION_AUTH)
    key = await session.get(ManagementApiKey, principal.api_key_id)
    if key is None:
        return CredentialSnapshot(
            auth_kind=MANAGEMENT_API_KEY_AUTH,
            api_key_id=principal.api_key_id,
        )
    return CredentialSnapshot(
        auth_kind=MANAGEMENT_API_KEY_AUTH,
        api_key_id=key.id,
        api_key_name=key.name,
        api_key_prefix=key.key_prefix,
    )


async def snapshot_caller_credential(
    principal: CallerCredential | None,
) -> CredentialSnapshot:
    """Read the snapshot in its own short session for socket entry points."""
    async with SessionLocal() as session:
        return await snapshot_from_principal(session, principal)


def snapshot_from_row(row) -> CredentialSnapshot:
    return CredentialSnapshot(
        auth_kind=getattr(row, "auth_kind", None),
        api_key_id=getattr(row, "api_key_id", None),
        api_key_name=getattr(row, "api_key_name", None),
        api_key_prefix=getattr(row, "api_key_prefix", None),
    )
