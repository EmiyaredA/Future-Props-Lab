from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.deps import SessionDep, WorkspaceDep
from app.files import AssetError, VisualAssets, download_filename
from app.files.layout_migration import LayoutMigrationBusyError, StorageLayoutMigration
from app.schemas.files import (
    StorageLayoutMigrationOut,
    StorageLayoutStatusOut,
    SvgPreviewIn,
    SvgPreviewOut,
    VisualAssetFolderCreateIn,
    VisualAssetFolderListOut,
    VisualAssetFolderOut,
    VisualAssetFolderPatchIn,
    VisualAssetListOut,
    VisualAssetOut,
    VisualAssetPatchIn,
)

router = APIRouter(tags=["file-management"])


def _assets(session: SessionDep, workspace_id: str) -> VisualAssets:
    return VisualAssets(session, get_settings(), workspace_id)


def asset_http_error(exc: AssetError) -> HTTPException:
    return HTTPException(
        exc.status,
        {"code": exc.code, "message": str(exc), **exc.detail},
    )


@router.get("/file-storage/layout", response_model=StorageLayoutStatusOut)
async def storage_layout_status(
    session: SessionDep, workspace_id: WorkspaceDep
) -> StorageLayoutStatusOut:
    return await StorageLayoutMigration(session, get_settings(), workspace_id).status()


@router.post("/file-storage/layout/migrate", response_model=StorageLayoutMigrationOut)
async def migrate_storage_layout(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    limit: int = Query(default=50, ge=1, le=100),
) -> StorageLayoutMigrationOut:
    try:
        return await StorageLayoutMigration(session, get_settings(), workspace_id).migrate(limit)
    except LayoutMigrationBusyError as exc:
        raise HTTPException(409, {"code": "storage_migration_busy", "message": str(exc)}) from None


@router.get("/file-folders", response_model=VisualAssetFolderListOut)
async def list_file_folders(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str | None = None,
) -> VisualAssetFolderListOut:
    try:
        return await _assets(session, workspace_id).list_folders(project_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.post("/file-folders", response_model=VisualAssetFolderOut)
async def create_file_folder(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    body: VisualAssetFolderCreateIn,
) -> VisualAssetFolderOut:
    try:
        return await _assets(session, workspace_id).create_folder(body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.patch("/file-folders/{folder_id}", response_model=VisualAssetFolderOut)
async def patch_file_folder(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    folder_id: str,
    body: VisualAssetFolderPatchIn,
) -> VisualAssetFolderOut:
    try:
        return await _assets(session, workspace_id).patch_folder(folder_id, body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.delete("/file-folders/{folder_id}")
async def delete_file_folder(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    folder_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _assets(session, workspace_id).delete_folder(folder_id, expected_revision)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return {"deleted": True}


@router.get("/files", response_model=VisualAssetListOut)
async def list_files(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str | None = None,
    folder_id: str | None = None,
    query: str = Query(default="", max_length=255),
    media_kind: Literal["image", "video", "audio", "font", "document"] | None = None,
    sort: Literal["updated", "name"] = "updated",
    include_references: bool = True,
    include_svg: bool = False,
) -> VisualAssetListOut:
    try:
        return await _assets(session, workspace_id).list_assets(
            project_id=project_id,
            folder_id=folder_id,
            query=query.strip(),
            media_kind=media_kind,
            sort=sort,
            include_references=include_references,
            include_svg=include_svg,
        )
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.post("/files", response_model=VisualAssetOut)
async def upload_file(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    upload: Annotated[UploadFile, File()],
    project_id: Annotated[str | None, Form()] = None,
    folder_id: Annotated[str | None, Form()] = None,
) -> VisualAssetOut:
    try:
        return await _assets(session, workspace_id).upload(
            upload, project_id=project_id, folder_id=folder_id
        )
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.patch("/files/{asset_id}", response_model=VisualAssetOut)
async def patch_file(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    asset_id: str,
    body: VisualAssetPatchIn,
) -> VisualAssetOut:
    try:
        return await _assets(session, workspace_id).patch_asset(asset_id, body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.delete("/files/{asset_id}")
async def delete_file(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    asset_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _assets(session, workspace_id).delete_asset(asset_id, expected_revision)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return {"deleted": True}


@router.get("/files/{asset_id}/content")
async def preview_file(
    session: SessionDep, workspace_id: WorkspaceDep, asset_id: str
) -> FileResponse:
    try:
        row, path = await _assets(session, workspace_id).content(asset_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return FileResponse(
        path,
        media_type=row.mime_type,
        filename=row.original_filename,
        content_disposition_type="inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            **(
                {
                    "Content-Security-Policy": (
                        "default-src 'none'; style-src 'unsafe-inline'; sandbox"
                    )
                }
                if row.mime_type == "image/svg+xml"
                else {}
            ),
        },
    )


@router.get("/files/{asset_id}/download")
async def download_file(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    asset_id: str,
    download_name: str | None = Query(default=None, max_length=255),
) -> FileResponse:
    try:
        row, path = await _assets(session, workspace_id).content(asset_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return FileResponse(
        path,
        media_type=row.mime_type,
        filename=download_filename(download_name or row.display_name, row.original_filename),
    )


@router.post("/files/svg/preview", response_model=SvgPreviewOut)
async def preview_svg(body: SvgPreviewIn, _workspace_id: WorkspaceDep) -> SvgPreviewOut:
    from app.files.svg import normalize_svg

    try:
        return SvgPreviewOut(**normalize_svg(body.svg))
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_svg", "message": str(exc)}) from None
