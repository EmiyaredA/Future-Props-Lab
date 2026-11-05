"""Shared HTTP operations on community metadata and favorites."""

from fastapi import APIRouter, HTTPException

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import CommunitySessionDep as SessionDep
from studio.apps.thought_workshop.knowledge_tools.schemas import ResolveReferences
from studio.apps.thought_workshop.publication.official_source import (
    LegacyTarget,
    SeedPreview,
    preview,
    receipt,
    resolve_legacy,
)
from studio.apps.thought_workshop.publication.references import CommunityReferenceTarget
from studio.apps.thought_workshop.publication.references import resolve as resolve_references
from studio.apps.thought_workshop.publication.schemas import (
    ArticleConfig,
    CommunityManagement,
    FavoriteInput,
    FavoritesOut,
    PermissionInput,
)
from studio.apps.thought_workshop.publication.use_cases import Community
from studio.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from studio.assembly.http_dependencies import PublicStudioAuth


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


router = APIRouter()


@router.put("/favorites/{namespace}/{resource_id}", response_model=FavoritesOut)
async def favorite(
    namespace: str,
    resource_id: str,
    body: FavoriteInput,
    session: SessionDep,
    principal: PublicStudioAuth,
):
    return await call(Community(session, principal).favorite(namespace + "/" + resource_id, body))


@router.get("/publications/{publication_id}/management", response_model=CommunityManagement)
async def management(publication_id: str, session: SessionDep, principal: PublicStudioAuth):
    return await call(Community(session, principal).management(publication_id))


@router.put("/publications/{publication_id}/permissions", response_model=list[ArticleConfig])
async def permissions(
    publication_id: str, body: PermissionInput, session: SessionDep, principal: PublicStudioAuth
):
    return await call(Community(session, principal).permissions(publication_id, body))


@router.get("/official-import/preview", response_model=SeedPreview)
async def import_preview(principal: PublicStudioAuth):
    try:
        return preview(principal)
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/official-import/{request_id}", response_model=ThoughtImportOut)
async def import_receipt(request_id: str, session: SessionDep, principal: PublicStudioAuth):
    return await call(receipt(session, principal, request_id))


@router.get("/official-links/{library_key}", response_model=list[LegacyTarget])
async def legacy_link(
    library_key: str, session: SessionDep, principal: PublicStudioAuth, document_key: str = ""
):
    return await call(Community(session, principal).run(resolve_legacy, library_key, document_key))


@router.post(
    "/publications/{publication_id}/references", response_model=list[CommunityReferenceTarget]
)
async def references(
    publication_id: str, body: ResolveReferences, session: SessionDep, principal: PublicStudioAuth
):
    return await call(
        Community(session, principal).run(resolve_references, publication_id, body.ids)
    )
