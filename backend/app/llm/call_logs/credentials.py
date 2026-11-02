"""Caller credential snapshots stored on model call logs."""

from __future__ import annotations

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.console.models.accounts import ManagementApiKey
from app.llm.credential_snapshot import (
    MANAGEMENT_API_KEY_AUTH,
    SESSION_AUTH,
)
from app.llm.credential_snapshot import (
    SESSION_FILTER as SESSION_FILTER,
)
from app.llm.credential_snapshot import (
    CredentialSnapshot as CredentialSnapshot,
)
from app.llm.credential_snapshot import (
    snapshot_from_row as snapshot_from_row,
)
from app.runtime.db import SessionLocal


class CallerCredential(Protocol):
    """The caller attributes a call log credential snapshot reads."""

    @property
    def auth_kind(self) -> str: ...

    @property
    def api_key_id(self) -> str | None: ...


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
