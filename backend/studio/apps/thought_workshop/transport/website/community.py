"""Browser-only protocol adapters. Publication use cases own all authorization."""

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import (
    CommunityDirectoryDep,
    request_account_directory,
)
from studio.apps.thought_workshop.http_bindings import CommunitySessionDep as SessionDep
from studio.apps.thought_workshop.publication.assets import LegacyCommunityFiles
from studio.apps.thought_workshop.publication.http import router as metadata_router
from studio.apps.thought_workshop.publication.imports import SeedImportInput, import_source
from studio.apps.thought_workshop.publication.schemas import (
    ArticleConfig,
    CommunityArticle,
    CommunityDirectory,
    CommunityNote,
    CommunityNotePut,
    CommunitySnapshot,
    FavoritesOut,
    PublicationConfig,
    PublicationOut,
    PublishInput,
)
from studio.apps.thought_workshop.publication.use_cases import Community
from studio.apps.thought_workshop.schemas.workshop import ThoughtAttachmentOut, ThoughtImportOut
from studio.assembly.http_dependencies import PublicStudioAuth
from studio.assembly.http_dependencies import SessionDep as BaseSessionDep
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.files.image_sizes import ThumbnailSize

router = APIRouter(prefix="/community", tags=["knowledge-community"])


async def call(operation):
    try:
        return await operation
    except (ThoughtError, AssetError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/publications", response_model=list[PublicationOut])
async def listing(
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    query: str = Query(default="", max_length=240),
    official: bool | None = None,
    mine: bool = False,
    favorites: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=48),
):
    return await call(
        Community(session, principal, accounts=accounts).list(
            query, mine, favorites, offset, limit, official
        )
    )


@router.get("/libraries/{library_id}/publication", response_model=PublicationConfig)
async def config(
    library_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(Community(session, principal, accounts=accounts).config(library_id))


@router.put("/libraries/{library_id}/publication", response_model=PublicationConfig)
async def publish(
    library_id: str,
    body: PublishInput,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(Community(session, principal, accounts=accounts).publish(library_id, body))


@router.get("/publications/{publication_id}", response_model=CommunityDirectory)
async def directory(
    publication_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(Community(session, principal, accounts=accounts).directory(publication_id))


@router.get("/publications/{publication_id}/notes/{note_id}", response_model=CommunityNote)
async def note(
    publication_id: str,
    note_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(
        Community(session, principal, accounts=accounts).get_note(publication_id, note_id)
    )


@router.put("/publications/{publication_id}/notes/{note_id}", response_model=CommunityNote)
async def save(
    request: Request,
    publication_id: str,
    note_id: str,
    body: CommunityNotePut,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(
        Community(session, principal, accounts=accounts).save_note(
            publication_id, note_id, body, source_assets=request.app.state.thought_source_assets
        )
    )


@router.get("/publications/{publication_id}/permissions", response_model=list[ArticleConfig])
async def settings(
    publication_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    note_id: list[str] = Query(min_length=1, max_length=2000),
):
    return await call(
        Community(session, principal, accounts=accounts).settings(publication_id, note_id)
    )


@router.get("/publications/{publication_id}/cover")
async def cover(
    request: Request,
    publication_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    size: ThumbnailSize | None = None,
):
    mime_type, path = await call(
        LegacyCommunityFiles(
            session,
            principal,
            accounts=accounts,
            settings=request.app.state.settings,
            previews=request.app.state.raster_previews,
        ).cover(publication_id, size)
    )
    return FileResponse(path, media_type=mime_type, headers={"Cache-Control": "private, no-store"})


@router.get("/publications/{publication_id}/assets/{asset_id}/content")
async def asset(
    request: Request,
    publication_id: str,
    asset_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    note_id: str | None = None,
    size: ThumbnailSize | None = None,
):
    mime_type, path = await call(
        LegacyCommunityFiles(
            session,
            principal,
            accounts=accounts,
            settings=request.app.state.settings,
            previews=request.app.state.raster_previews,
        ).asset(publication_id, asset_id, note_id, size)
    )
    return FileResponse(
        path,
        media_type=mime_type,
        headers={"Content-Disposition": "inline", "Cache-Control": "private, no-store"},
    )


@router.post(
    "/publications/{publication_id}/notes/{note_id}/uploads", response_model=ThoughtAttachmentOut
)
async def upload(
    request: Request,
    publication_id: str,
    note_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    upload: UploadFile = File(),
):
    return await call(
        LegacyCommunityFiles(
            session,
            principal,
            accounts=accounts,
            settings=request.app.state.settings,
            previews=request.app.state.raster_previews,
        ).upload(publication_id, note_id, upload)
    )


@router.get("/publications/{publication_id}/export-snapshot", response_model=CommunitySnapshot)
async def export(
    publication_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(Community(session, principal, accounts=accounts).snapshot(publication_id))


@router.get(
    "/publications/{publication_id}/notes/{note_id}/backlinks",
    response_model=list[CommunityArticle],
)
async def backlinks(
    publication_id: str,
    note_id: str,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    return await call(
        Community(session, principal, accounts=accounts).backlinks(
            publication_id, note_id, offset, limit
        )
    )


@router.get("/favorites", response_model=FavoritesOut)
async def favorites(
    session: SessionDep, accounts: CommunityDirectoryDep, principal: PublicStudioAuth
):
    return await call(Community(session, principal, accounts=accounts).favorites())


@router.put("/publications/{publication_id}/management", response_model=PublicationConfig)
async def manage(
    publication_id: str,
    body: PublishInput,
    session: SessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await call(Community(session, principal, accounts=accounts).manage(publication_id, body))


@router.post("/official-import", response_model=ThoughtImportOut)
async def import_official(
    body: SeedImportInput,
    session: BaseSessionDep,
    principal: PublicStudioAuth,
    request: Request,
):
    async with request.app.state.thought_official_imports:
        accounts = await request_account_directory(request, session, principal)
        return await call(import_source(session, principal, body, accounts=accounts))


router.include_router(metadata_router, prefix="")
