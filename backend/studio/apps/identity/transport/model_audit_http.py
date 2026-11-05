"""Models-only audit intents and settlement, absent from public discovery."""

from fastapi import APIRouter, Depends, Request
from starlette.responses import JSONResponse

from studio.apps.identity.catalog_events import require_models
from studio.contracts.model_service.model_audit import (
    ChildModelAudit,
    ModelAuditRecord,
    PreparedModelAudit,
)

router = APIRouter(
    prefix="/_internal/v1/model-audit",
    include_in_schema=False,
    dependencies=[Depends(require_models)],
)


@router.post("/prepare")
async def prepare(request: Request, body: ModelAuditRecord):
    value = await request.app.state.model_audit_inbox.prepare(body)
    return JSONResponse(value.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@router.post("/prepare-child")
async def prepare_child(request: Request, body: ChildModelAudit):
    value = await request.app.state.model_audit_inbox.prepare_child(body)
    return JSONResponse(value.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@router.post("/commit")
async def commit(request: Request, body: PreparedModelAudit):
    value = await request.app.state.model_audit_inbox.commit(body)
    return JSONResponse(value.model_dump(mode="json"), headers={"Cache-Control": "no-store"})
