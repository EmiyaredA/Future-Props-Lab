from fastapi import APIRouter, Depends, HTTPException

from app.console.governance.code_agents import (
    CatalogOut,
    GrantsOut,
    GrantUpdate,
    catalog,
    read_grants,
    save_grants,
)
from app.deps import SessionDep, StudioAuth
from app.runtime.operation_receipts import OperationError


def require_browser(principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})


router = APIRouter(
    prefix="/code-agents", tags=["code-agents"], dependencies=[Depends(require_browser)]
)


@router.get("", response_model=CatalogOut)
async def list_code_agents(session: SessionDep, principal: StudioAuth):
    return await catalog(session, principal)


@router.post("/detect", response_model=CatalogOut)
async def detect_code_agents(session: SessionDep, principal: StudioAuth):
    return await catalog(session, principal)


@router.get("/grants", response_model=GrantsOut)
async def get_code_agent_grants(session: SessionDep, principal: StudioAuth):
    return await read_grants(session, principal)


@router.put("/grants", response_model=GrantsOut)
async def put_code_agent_grants(body: GrantUpdate, session: SessionDep, principal: StudioAuth):
    try:
        return await save_grants(session, principal, body)
    except OperationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
