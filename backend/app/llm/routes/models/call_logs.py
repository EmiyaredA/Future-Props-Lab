from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response

from app.llm.call_logs import CallLogService, ReproductionUnavailableError
from app.llm.schemas.call_log import (
    BatchDeleteIn,
    CallLogListOut,
    CallLogOut,
    CallLogQuery,
    CallLogStatsOut,
)
from studio.assembly.http_dependencies import OwnerDep, SessionDep, StudioAuth

router = APIRouter(prefix="/llm-call-logs", tags=["model-logs"])


def _logs(session: SessionDep, owner_user_id: str) -> CallLogService:
    return CallLogService(session, owner_user_id)


@router.get("", response_model=CallLogListOut)
async def list_logs(
    session: SessionDep,
    owner_user_id: OwnerDep,
    filters: Annotated[CallLogQuery, Query()],
) -> CallLogListOut:
    return await _logs(session, owner_user_id).list(**filters.service_filters())


@router.get("/stats", response_model=CallLogStatsOut)
async def stats(session: SessionDep, owner_user_id: OwnerDep) -> CallLogStatsOut:
    return await _logs(session, owner_user_id).stats()


@router.get("/{log_id}", response_model=CallLogOut)
async def detail(
    principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep, log_id: str
) -> CallLogOut:
    row = await _logs(session, owner_user_id).get(log_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    if not principal.allows("diagnostics.model"):
        row = row.model_copy(
            update={
                "request_payload": {},
                "response_payload": {},
                "error_message": None,
                "reproduction_supported": False,
                "reproduction_reason": "当前身份不能查看完整诊断",
            }
        )
    return row


@router.get(
    "/{log_id}/reproduction-bundle",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
async def reproduction_bundle(
    principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep, log_id: str
) -> Response:
    if not principal.allows("diagnostics.model"):
        raise HTTPException(403, {"code": "model_diagnostics_required"})
    try:
        bundle = await _logs(session, owner_user_id).reproduction_bundle(log_id)
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
async def delete_one(session: SessionDep, owner_user_id: OwnerDep, log_id: str) -> dict[str, bool]:
    if not await _logs(session, owner_user_id).delete(log_id):
        raise HTTPException(404, {"code": "not_found", "message": "调用日志不存在"})
    return {"ok": True}


@router.post("/batch-delete")
async def batch_delete(
    session: SessionDep, owner_user_id: OwnerDep, body: BatchDeleteIn
) -> dict[str, int]:
    return {"deleted": await _logs(session, owner_user_id).batch_delete(body.ids)}
