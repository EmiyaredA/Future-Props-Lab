from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.models import IntegrationCheck
from app.integrations.schemas import IntegrationCheckOut
from app.runtime.time import iso_utc


def check_out(row: IntegrationCheck) -> IntegrationCheckOut:
    return IntegrationCheckOut(
        id=row.id,
        resource_kind=row.resource_kind,
        resource_id=row.resource_id,
        resource_name=row.resource_name,
        ok=row.ok,
        status_code=row.status_code,
        latency_ms=row.latency_ms,
        summary=row.summary,
        created_at=iso_utc(row.created_at),
    )


async def list_recent_checks(
    session: AsyncSession, owner_user_id: str, kind: str, *, limit: int = 8
) -> list[IntegrationCheckOut]:
    rows = (
        (
            await session.execute(
                select(IntegrationCheck)
                .where(
                    IntegrationCheck.owner_user_id == owner_user_id,
                    IntegrationCheck.resource_kind == kind,
                )
                .order_by(IntegrationCheck.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [check_out(row) for row in rows]


async def record_check(
    session: AsyncSession,
    *,
    owner_user_id: str,
    kind: str,
    resource_id: str,
    resource_name: str,
    ok: bool,
    status_code: int | None,
    latency_ms: int,
    summary: str,
) -> IntegrationCheckOut:
    row = IntegrationCheck(
        owner_user_id=owner_user_id,
        resource_kind=kind,
        resource_id=resource_id,
        resource_name=resource_name,
        ok=ok,
        status_code=status_code,
        latency_ms=max(0, latency_ms),
        summary=summary[:500],
    )
    session.add(row)
    await session.flush()
    old_ids = (
        await session.execute(
            select(IntegrationCheck.id)
            .where(
                IntegrationCheck.owner_user_id == owner_user_id,
                IntegrationCheck.resource_kind == kind,
            )
            .order_by(IntegrationCheck.created_at.desc())
            .offset(200)
        )
    ).scalars()
    stale = list(old_ids)
    if stale:
        await session.execute(
            delete(IntegrationCheck).where(
                IntegrationCheck.owner_user_id == owner_user_id, IntegrationCheck.id.in_(stale)
            )
        )
    return check_out(row)
