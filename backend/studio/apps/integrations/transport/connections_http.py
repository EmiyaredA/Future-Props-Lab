from fastapi import APIRouter, HTTPException, Request

from studio.apps.integrations.transport.bindings import external_catalog
from studio.assembly.http_dependencies import OwnerDep, SessionDep, StudioAuth
from studio.contracts.integrations.external_connections import (
    ExternalConnectionInput,
    ExternalConnectionList,
    ExternalConnectionOut,
    ExternalConnectionUpdate,
    ExternalTargetInput,
    ExternalTargetOut,
)
from studio.contracts.integrations.external_documents import ExternalError

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
async def list_connections(
    request: Request, principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(principal, external_catalog(request, session, owner_user_id).list())


@router.post("", response_model=ExternalConnectionOut, status_code=201)
async def create_connection(
    request: Request,
    body: ExternalConnectionInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(principal, external_catalog(request, session, owner_user_id).save(body))


@router.patch("/{connection_id}", response_model=ExternalConnectionOut)
async def update_connection(
    request: Request,
    connection_id: str,
    body: ExternalConnectionUpdate,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(
        principal, external_catalog(request, session, owner_user_id).save(body, connection_id)
    )


@router.post("/{connection_id}/check", response_model=ExternalConnectionOut)
async def check_connection(
    request: Request,
    connection_id: str,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(
        principal, external_catalog(request, session, owner_user_id).check(connection_id)
    )


@router.post("/{connection_id}/target-check", response_model=ExternalTargetOut)
async def check_target(
    request: Request,
    connection_id: str,
    body: ExternalTargetInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(
        principal, external_catalog(request, session, owner_user_id).target(connection_id, body.url)
    )
