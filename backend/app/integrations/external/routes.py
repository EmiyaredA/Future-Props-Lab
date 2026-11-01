from fastapi import APIRouter, HTTPException

from app.deps import OwnerDep, SessionDep, StudioAuth

from .catalog import ExternalConnections
from .contracts import ExternalError
from .schemas import (
    ExternalConnectionInput,
    ExternalConnectionList,
    ExternalConnectionOut,
    ExternalConnectionUpdate,
    ExternalTargetInput,
    ExternalTargetOut,
)

router = APIRouter(prefix="/integrations/external-connections", tags=["integrations"])


async def call(principal, operation):
    if not principal.allows("configuration.manage"):
        operation.close()
        raise HTTPException(403, "需要账号管理员或拥有者权限")
    try:
        return await operation
    except ExternalError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("", response_model=ExternalConnectionList)
async def list_connections(principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep):
    return await call(principal, ExternalConnections(session, owner_user_id).list())


@router.post("", response_model=ExternalConnectionOut, status_code=201)
async def create_connection(
    body: ExternalConnectionInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(principal, ExternalConnections(session, owner_user_id).save(body))


@router.patch("/{connection_id}", response_model=ExternalConnectionOut)
async def update_connection(
    connection_id: str,
    body: ExternalConnectionUpdate,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(
        principal, ExternalConnections(session, owner_user_id).save(body, connection_id)
    )


@router.post("/{connection_id}/check", response_model=ExternalConnectionOut)
async def check_connection(
    connection_id: str, principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(principal, ExternalConnections(session, owner_user_id).check(connection_id))


@router.post("/{connection_id}/target-check", response_model=ExternalTargetOut)
async def check_target(
    connection_id: str,
    body: ExternalTargetInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(
        principal, ExternalConnections(session, owner_user_id).target(connection_id, body.url)
    )
