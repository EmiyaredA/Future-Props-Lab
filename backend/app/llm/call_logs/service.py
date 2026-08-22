from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant_context import current_workspace_id
from app.core.time import iso_utc
from app.models import LlmCallLog
from app.schemas.call_log import (
    CallLogListItem,
    CallLogListOut,
    CallLogOut,
    CallLogStatsOut,
)


def _detail(row: LlmCallLog) -> CallLogOut:
    return CallLogOut(
        id=row.id,
        call_source=row.call_source,
        provider_kind=row.provider_kind,
        model=row.model,
        trace_id=row.trace_id,
        request_payload=row.request_payload,
        response_payload=row.response_payload,
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        total_tokens=row.total_tokens,
        latency_ms=row.latency_ms,
        status=row.status,
        error_message=row.error_message,
        created_at=iso_utc(row.created_at),
    )


class CallLogService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(
        self,
        *,
        q: str,
        call_source: str,
        provider_kind: str,
        model: str,
        status: str,
        from_dt: datetime | None,
        to_dt: datetime | None,
        page: int,
        page_size: int,
    ) -> CallLogListOut:
        filters = []
        if q:
            pattern = f"%{q}%"
            filters.append(
                or_(
                    LlmCallLog.id.ilike(pattern),
                    LlmCallLog.trace_id.ilike(pattern),
                    LlmCallLog.model.ilike(pattern),
                )
            )
        if call_source:
            filters.append(LlmCallLog.call_source == call_source)
        if provider_kind:
            filters.append(LlmCallLog.provider_kind == provider_kind)
        if model:
            filters.append(LlmCallLog.model == model)
        if status:
            filters.append(LlmCallLog.status == status)
        if from_dt:
            filters.append(LlmCallLog.created_at >= from_dt)
        if to_dt:
            filters.append(LlmCallLog.created_at <= to_dt)
        predicate = and_(*filters) if filters else True
        total = int(
            (
                await self.session.execute(select(func.count(LlmCallLog.id)).where(predicate))
            ).scalar_one()
        )
        rows = (
            (
                await self.session.execute(
                    select(LlmCallLog)
                    .where(predicate)
                    .order_by(LlmCallLog.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            )
            .scalars()
            .all()
        )
        return CallLogListOut(
            items=[
                CallLogListItem(
                    id=row.id,
                    call_source=row.call_source,
                    provider_kind=row.provider_kind,
                    model=row.model,
                    trace_id=row.trace_id,
                    total_tokens=row.total_tokens,
                    latency_ms=row.latency_ms,
                    status=row.status,
                    created_at=iso_utc(row.created_at),
                )
                for row in rows
            ],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def stats(self) -> CallLogStatsOut:
        start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
        row = (
            await self.session.execute(
                select(
                    func.count(LlmCallLog.id),
                    func.coalesce(func.sum(LlmCallLog.total_tokens), 0),
                    func.coalesce(func.avg(LlmCallLog.latency_ms), 0),
                    func.sum(case((LlmCallLog.status == "error", 1), else_=0)),
                ).where(LlmCallLog.created_at >= start)
            )
        ).one()
        return CallLogStatsOut(
            calls_today=int(row[0] or 0),
            total_tokens_today=int(row[1] or 0),
            avg_latency_ms_today=int(row[2] or 0),
            errors_today=int(row[3] or 0),
        )

    async def get(self, log_id: str) -> CallLogOut | None:
        row = await self.session.get(LlmCallLog, log_id)
        return _detail(row) if row else None

    async def delete(self, log_id: str) -> bool:
        result = await self.session.execute(
            delete(LlmCallLog).where(
                LlmCallLog.id == log_id,
                LlmCallLog.workspace_id == current_workspace_id(),
            )
        )
        await self.session.commit()
        return bool(result.rowcount)

    async def batch_delete(self, ids: list[str]) -> int:
        if not ids:
            return 0
        result = await self.session.execute(
            delete(LlmCallLog).where(
                LlmCallLog.id.in_(ids),
                LlmCallLog.workspace_id == current_workspace_id(),
            )
        )
        await self.session.commit()
        return int(result.rowcount or 0)
