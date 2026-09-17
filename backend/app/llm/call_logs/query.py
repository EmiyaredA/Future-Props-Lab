"""Read-only log predicates shared with explicitly authorized account governance."""

from datetime import UTC, datetime

from sqlalchemy import case, func, or_, select

from app.llm.call_logs.credentials import SESSION_AUTH, SESSION_FILTER
from app.models import LlmCallLog
from app.schemas.call_log import CallLogStatsOut


def log_conditions(
    *,
    q,
    call_source,
    provider_kind,
    model,
    status,
    from_dt,
    to_dt,
    api_key_id="",
    include_source_search=False,
):
    conditions = []
    if q:
        columns = [LlmCallLog.id, LlmCallLog.trace_id, LlmCallLog.model]
        if include_source_search:
            columns.append(LlmCallLog.call_source)
        conditions.append(or_(*(column.ilike(f"%{q}%") for column in columns)))
    for column, value in (
        (LlmCallLog.call_source, call_source),
        (LlmCallLog.provider_kind, provider_kind),
        (LlmCallLog.model, model),
        (LlmCallLog.status, status),
    ):
        if value:
            conditions.append(column == value)
    if api_key_id == SESSION_FILTER:
        conditions.append(LlmCallLog.auth_kind == SESSION_AUTH)
    elif api_key_id:
        conditions.append(LlmCallLog.api_key_id == api_key_id)
    if from_dt:
        conditions.append(LlmCallLog.created_at >= from_dt)
    if to_dt:
        conditions.append(LlmCallLog.created_at <= to_dt)
    return conditions


async def today_stats(session, *conditions):
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    row = (
        await session.execute(
            select(
                func.count(LlmCallLog.id),
                func.coalesce(func.sum(LlmCallLog.total_tokens), 0),
                func.coalesce(func.avg(LlmCallLog.latency_ms), 0),
                func.sum(case((LlmCallLog.status == "error", 1), else_=0)),
            ).where(*conditions, LlmCallLog.created_at >= start)
        )
    ).one()
    return CallLogStatsOut(
        calls_today=int(row[0] or 0),
        total_tokens_today=int(row[1] or 0),
        avg_latency_ms_today=int(row[2] or 0),
        errors_today=int(row[3] or 0),
    )
