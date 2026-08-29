from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Response

from app.deps import SessionDep, WorkspaceDep
from app.llm.call_logs import CallLogService, ReproductionUnavailableError
from app.schemas.call_log import (
    BatchDeleteIn,
    CallLogListOut,
    CallLogOut,
    CallLogStatsOut,
)

router = APIRouter(prefix="/llm-call-logs", tags=["model-logs"])


def _logs(session: SessionDep, workspace_id: str) -> CallLogService:
    return CallLogService(session, workspace_id)


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
    workspace_id: WorkspaceDep,
    q: str = Query("", max_length=200),
    call_source: str = Query(
        "",
        pattern=(
            "^(|model_diagnostic|model_playground|visual_workshop_assistant|"
            "visual_workshop_generation|audio_annotation)$"
        ),
    ),
    provider_kind: str = Query(
        "", pattern="^(|openai|anthropic|senseaudio_asr|senseaudio_realtime)$"
    ),
    model: str = Query("", max_length=160),
    status: str = Query("", pattern="^(|success|error)$"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> CallLogListOut:
    return await _logs(session, workspace_id).list(
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
async def stats(session: SessionDep, workspace_id: WorkspaceDep) -> CallLogStatsOut:
    return await _logs(session, workspace_id).stats()


@router.get("/{log_id}", response_model=CallLogOut)
async def detail(session: SessionDep, workspace_id: WorkspaceDep, log_id: str) -> CallLogOut:
    row = await _logs(session, workspace_id).get(log_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    return row


@router.get(
    "/{log_id}/reproduction-bundle",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
async def reproduction_bundle(
    session: SessionDep, workspace_id: WorkspaceDep, log_id: str
) -> Response:
    try:
        bundle = await _logs(session, workspace_id).reproduction_bundle(log_id)
    except ReproductionUnavailableError as exc:
        raise HTTPException(
            409,
            {"code": "reproduction_unavailable", "message": str(exc)},
        ) from exc
    if bundle is None:
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    return Response(
        content=bundle.content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{bundle.filename}"'},
    )


@router.delete("/{log_id}")
async def delete_one(
    session: SessionDep, workspace_id: WorkspaceDep, log_id: str
) -> dict[str, bool]:
    if not await _logs(session, workspace_id).delete(log_id):
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    return {"ok": True}


@router.post("/batch-delete")
async def batch_delete(
    session: SessionDep, workspace_id: WorkspaceDep, body: BatchDeleteIn
) -> dict[str, int]:
    return {"deleted": await _logs(session, workspace_id).batch_delete(body.ids)}
