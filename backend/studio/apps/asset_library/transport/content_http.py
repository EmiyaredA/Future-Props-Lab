"""Shared HTTP contract; each host supplies its owned file/protection adapters."""

from fastapi import APIRouter, HTTPException, Request

from studio.apps.asset_library.content_audits import ContentAudits
from studio.apps.asset_library.content_cleanup import ContentCleanup
from studio.contracts.asset_library.content_identity import (
    ContentAudit,
    ContentAuditRequest,
    ContentIdentities,
    DedupeStep,
    IdentityRequest,
)
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.http.dependencies import OwnerDep, SessionDep


def content_router(bind, *, session_dep=SessionDep, owner_dep=OwnerDep):
    router = APIRouter(tags=["file-management"])

    async def call(action):
        try:
            return await action
        except AssetError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None

    @router.post("/files/content-identities", response_model=ContentIdentities)
    async def inspect_file_content_identities(
        request: Request, session: session_dep, owner: owner_dep, body: IdentityRequest
    ):
        return await call(bind(request, session, owner).identities(body.asset_ids))

    @router.post("/file-library/content-audits", response_model=ContentAudit)
    async def create_file_content_audit(
        request: Request, session: session_dep, owner: owner_dep, body: ContentAuditRequest
    ):
        return await call(bind(request, session, owner).create(body))

    @router.get("/file-library/content-audits/{operation_id}", response_model=ContentAudit)
    async def get_file_content_audit(
        request: Request, session: session_dep, owner: owner_dep, operation_id: str
    ):
        return await call(bind(request, session, owner).status(operation_id))

    @router.post("/file-library/content-audits/{operation_id}/prepare", response_model=ContentAudit)
    async def prepare_file_duplicate_group(
        request: Request,
        session: session_dep,
        owner: owner_dep,
        operation_id: str,
        body: DedupeStep,
    ):
        return await call(ContentCleanup(bind(request, session, owner)).prepare(operation_id, body))

    @router.post("/file-library/content-audits/{operation_id}/clean", response_model=ContentAudit)
    async def clean_file_duplicate_group(
        request: Request,
        session: session_dep,
        owner: owner_dep,
        operation_id: str,
        body: DedupeStep,
    ):
        return await call(ContentCleanup(bind(request, session, owner)).clean(operation_id, body))

    @router.post("/file-library/content-audits/{operation_id}/restore", response_model=ContentAudit)
    async def restore_file_duplicate_group(
        request: Request,
        session: session_dep,
        owner: owner_dep,
        operation_id: str,
        body: DedupeStep,
    ):
        return await call(ContentCleanup(bind(request, session, owner)).restore(operation_id, body))

    return router


def independent_content_audits(request, session, owner):
    from studio.apps.asset_library.transport.service.context import cases

    return ContentAudits(cases(request, session, owner))


router = content_router(independent_content_audits)
