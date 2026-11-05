from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.contracts.creative_workshop.catalog import (
    CreativeDraftIn,
    CreativeDraftUpdateIn,
    CreativeImportIn,
    CreativeInstallOut,
    CreativeInstallPreviewIn,
    CreativeInstallPreviewOut,
    CreativeItemOut,
    CreativePageOut,
    CreativeReleaseOut,
    CreativeRevisionIn,
    CreativeStdioSetupIn,
)
from studio.contracts.creative_workshop.errors import CreativeError, CreativeFileError
from studio.contracts.integrations.errors import IntegrationValidationError
from studio.runtime.files.image_sizes import ThumbnailSize
from studio.runtime.files.raster import RasterPreviewError

router = APIRouter(prefix="/creative-workshop", tags=["creative-workshop"])
catalog_router = APIRouter()


def _raise(exc: Exception) -> None:
    if isinstance(exc, RasterPreviewError):
        raise HTTPException(422, {"code": exc.code, "message": str(exc)}) from exc
    if isinstance(exc, CreativeError):
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc
    raise HTTPException(422, {"code": "invalid_upload", "message": str(exc)}) from exc


@catalog_router.get("/items", response_model=CreativePageOut)
async def list_items(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    kind: str | None = None,
    q: str = "",
    mine: bool = False,
    cursor: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=48),
) -> CreativePageOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).list(
            kind=kind,
            query=q,
            mine=mine,
            cursor=cursor,
            limit=limit,
        )
    except CreativeError as exc:
        _raise(exc)


@catalog_router.post("/items", response_model=CreativeItemOut, status_code=201)
async def create_item(
    request: Request, session: SessionDep, principal: StudioAuth, body: CreativeDraftIn
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).create(body)
    except CreativeError as exc:
        _raise(exc)


@router.post("/items/from-integration", response_model=CreativeItemOut, status_code=201)
async def import_item(
    request: Request, session: SessionDep, principal: StudioAuth, body: CreativeImportIn
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).import_source(
            body.kind, body.source_id
        )
    except CreativeError as exc:
        _raise(exc)


@catalog_router.get("/releases/{release_id}", response_model=CreativeReleaseOut)
async def get_release(
    request: Request, session: SessionDep, principal: StudioAuth, release_id: str
) -> CreativeReleaseOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).get_release(
            release_id
        )
    except CreativeError as exc:
        _raise(exc)


@catalog_router.get("/releases/{release_id}/cover")
async def release_cover(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    release_id: str,
    size: ThumbnailSize | None = None,
) -> FileResponse:
    try:
        return FileResponse(
            await request.app.state.creative_catalog(
                request, session, principal
            ).release_cover_file(release_id, size, previews=request.app.state.raster_previews),
            media_type="image/webp",
            headers={"Cache-Control": "private, no-store"},
        )
    except (CreativeError, RasterPreviewError) as exc:
        _raise(exc)


@catalog_router.get("/items/{item_id}", response_model=CreativeItemOut)
async def get_item(
    request: Request, session: SessionDep, principal: StudioAuth, item_id: str, draft: bool = False
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).get(
            item_id, draft=draft
        )
    except CreativeError as exc:
        _raise(exc)


@catalog_router.patch("/items/{item_id}", response_model=CreativeItemOut)
async def update_item(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    item_id: str,
    body: CreativeDraftUpdateIn,
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).update(
            item_id, body
        )
    except CreativeError as exc:
        _raise(exc)


@catalog_router.post("/items/{item_id}/publish", response_model=CreativeItemOut)
async def publish_item(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    item_id: str,
    body: CreativeRevisionIn,
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).publish(
            item_id, body.expected_revision
        )
    except (CreativeError, CreativeFileError) as exc:
        _raise(exc)


@catalog_router.post("/items/{item_id}/withdraw", response_model=CreativeItemOut)
async def withdraw_item(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    item_id: str,
    body: CreativeRevisionIn,
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).withdraw(
            item_id, body.expected_revision
        )
    except CreativeError as exc:
        _raise(exc)


@catalog_router.get("/items/{item_id}/cover")
async def item_cover(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    item_id: str,
    draft: bool = False,
    size: ThumbnailSize | None = None,
) -> FileResponse:
    try:
        return FileResponse(
            await request.app.state.creative_catalog(request, session, principal).cover_file(
                item_id, draft=draft, size=size, previews=request.app.state.raster_previews
            ),
            media_type="image/webp",
            headers={"Cache-Control": "private, no-store"},
        )
    except (CreativeError, RasterPreviewError) as exc:
        _raise(exc)


@catalog_router.post("/items/{item_id}/cover", response_model=CreativeItemOut)
async def upload_cover(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    item_id: str,
    expected_revision: int = Form(ge=0),
    file: UploadFile = File(),
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).upload_cover(
            item_id, expected_revision, file
        )
    except (CreativeError, CreativeFileError) as exc:
        _raise(exc)


@catalog_router.post("/items/{item_id}/skill-archive", response_model=CreativeItemOut)
async def upload_skill(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    item_id: str,
    expected_revision: int = Form(ge=0),
    file: UploadFile = File(),
) -> CreativeItemOut:
    try:
        return await request.app.state.creative_catalog(request, session, principal).upload_skill(
            item_id, expected_revision, file
        )
    except (CreativeError, CreativeFileError, IntegrationValidationError) as exc:
        _raise(exc)


@router.post("/installations/preview", response_model=CreativeInstallPreviewOut)
async def preview_install(
    request: Request, session: SessionDep, principal: StudioAuth, body: CreativeInstallPreviewIn
) -> CreativeInstallPreviewOut:
    try:
        return await request.app.state.creative_installer(request, session, principal).preview(body)
    except CreativeError as exc:
        _raise(exc)


@router.post("/installations", response_model=CreativeInstallOut, status_code=201)
async def install(
    request: Request, session: SessionDep, principal: StudioAuth, body: CreativeInstallPreviewIn
) -> CreativeInstallOut:
    try:
        return await request.app.state.creative_installer(request, session, principal).install(body)
    except CreativeError as exc:
        _raise(exc)


@router.post("/installations/{installation_id}/stdio", response_model=CreativeInstallOut)
async def configure_stdio(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    installation_id: str,
    body: CreativeStdioSetupIn,
) -> CreativeInstallOut:
    try:
        return await request.app.state.creative_installer(
            request, session, principal
        ).configure_stdio(installation_id, body)
    except CreativeError as exc:
        _raise(exc)


router.include_router(catalog_router)
