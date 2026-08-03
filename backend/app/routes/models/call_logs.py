from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.deps import SessionDep
from app.llm.call_logs import CallLogService
from app.schemas.call_log import (
    BatchDeleteIn,
    CallLogListOut,
    CallLogOut,
    CallLogStatsOut,
)

router = APIRouter(prefix="/llm-call-logs", tags=["model-logs"])


def _date(value: str | None, *, end: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        if len(value) == 10:
            return datetime.fromisoformat(value + ("T23:59:59.999999" if end else "T00:00:00"))
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(400, {"code": "invalid_date", "message": "日期格式无效"}) from exc


@router.get("", response_model=CallLogListOut)
async def list_logs(
    session: SessionDep,
    q: str = Query("", max_length=200),
    call_source: str = Query("", pattern="^(|model_diagnostic|model_playground)$"),
    provider_kind: str = Query("", pattern="^(|openai|anthropic)$"),
    model: str = Query("", max_length=160),
    status: str = Query("", pattern="^(|success|error)$"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> CallLogListOut:
    return await CallLogService(session).list(
        q=q.strip(),
        call_source=call_source,
        provider_kind=provider_kind,
        model=model.strip(),
        status=status,
        from_dt=_date(from_),
        to_dt=_date(to, end=True),
        page=page,
        page_size=page_size,
    )


@router.get("/stats", response_model=CallLogStatsOut)
async def stats(session: SessionDep) -> CallLogStatsOut:
    return await CallLogService(session).stats()


@router.get("/{log_id}", response_model=CallLogOut)
async def detail(session: SessionDep, log_id: str) -> CallLogOut:
    row = await CallLogService(session).get(log_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    return row


@router.delete("/{log_id}")
async def delete_one(session: SessionDep, log_id: str) -> dict[str, bool]:
    if not await CallLogService(session).delete(log_id):
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    return {"ok": True}


@router.post("/batch-delete")
async def batch_delete(session: SessionDep, body: BatchDeleteIn) -> dict[str, int]:
    return {"deleted": await CallLogService(session).batch_delete(body.ids)}
