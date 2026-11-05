from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.call_logs.query import log_conditions, today_stats
from app.llm.call_logs.reproduction import (
    ReproductionBundle,
    build_reproduction_bundle,
    reproduction_support,
)
from app.llm.models import LlmCallLog, ModelEntry, ModelProvider
from app.llm.schemas.call_log import (
    CallLogListItem,
    CallLogListOut,
    CallLogOut,
    CallLogStatsOut,
)
from studio.runtime.time import iso_utc


def _credential_fields(row: LlmCallLog) -> dict:
    return {
        "auth_kind": row.auth_kind,
        "api_key_id": row.api_key_id,
        "api_key_name": row.api_key_name,
        "api_key_prefix": row.api_key_prefix,
    }


def _detail(row: LlmCallLog) -> CallLogOut:
    reproduction_supported, reproduction_reason = reproduction_support(row)
    return CallLogOut(
        id=row.id,
        call_source=row.call_source,
        provider_kind=row.provider_kind,
        model=row.model,
        **_credential_fields(row),
        trace_id=row.trace_id,
        request_payload=row.request_payload,
        response_payload=row.response_payload,
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        total_tokens=row.total_tokens,
        latency_ms=row.latency_ms,
        status=row.status,
        error_message=row.error_message,
        reproduction_supported=reproduction_supported,
        reproduction_reason=reproduction_reason,
        created_at=iso_utc(row.created_at),
    )


class CallLogService:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def list(
        self,
        *,
        q: str,
        call_source: str,
        provider_kind: str,
        model: str,
        api_key_id: str = "",
        status: str,
        from_dt: datetime | None,
        to_dt: datetime | None,
        page: int,
        page_size: int,
    ) -> CallLogListOut:
        filters = log_conditions(
            q=q,
            call_source=call_source,
            provider_kind=provider_kind,
            model=model,
            api_key_id=api_key_id,
            status=status,
            from_dt=from_dt,
            to_dt=to_dt,
        )
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
                    .order_by(LlmCallLog.created_at.desc(), LlmCallLog.id)
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
                    **_credential_fields(row),
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
        return await today_stats(self.session)

    async def get(self, log_id: str) -> CallLogOut | None:
        row = await self.session.get(LlmCallLog, log_id)
        return _detail(row) if row else None

    async def reproduction_bundle(self, log_id: str) -> ReproductionBundle | None:
        row = await self.session.get(LlmCallLog, log_id)
        if row is None:
            return None
        base_url = await self.session.scalar(
            select(ModelProvider.base_url)
            .join(ModelEntry, ModelEntry.provider_id == ModelProvider.id)
            .where(
                ModelProvider.kind == row.provider_kind,
                ModelEntry.slug == row.model,
            )
            .order_by(ModelProvider.enabled.desc(), ModelProvider.updated_at.desc())
            .limit(1)
        )
        return build_reproduction_bundle(row, base_url=str(base_url or ""))

    async def delete(self, log_id: str) -> bool:
        result = await self.session.execute(
            delete(LlmCallLog).where(
                LlmCallLog.id == log_id,
                LlmCallLog.owner_user_id == self.owner_user_id,
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
                LlmCallLog.owner_user_id == self.owner_user_id,
            )
        )
        await self.session.commit()
        return int(result.rowcount or 0)
