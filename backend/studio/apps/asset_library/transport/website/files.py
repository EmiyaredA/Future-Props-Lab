from __future__ import annotations

import shutil
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from studio.apps.asset_library.archives.folder_archive import (
    LibraryFolderArchive,
    LibraryFolderArchiveError,
)
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.layout.account_upgrade import (
    AccountUpgradeBusyError,
    migrate_accounts,
    upgrade_status,
)
from studio.apps.asset_library.storage.layout.website_upgrade import (
    LayoutMigrationBusyError,
    StorageLayoutMigration,
)
from studio.apps.asset_library.storage.website_files import VisualAssets
from studio.assembly.http_dependencies import (
    OwnerDep,
    SessionDep,
    StudioAuth,
    require_recent_reauthentication,
)
from studio.config.settings import get_settings
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.files import (
    FILE_CONTENT_HEADERS,
    LibraryAssetImportIn,
    LibraryFolderImportOut,
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
from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut
from studio.host.project_files.folders import ProjectFolderError, open_library_folder
from studio.runtime.files.names import download_filename

router = APIRouter(tags=["file-management"])


def _assets(session: SessionDep, owner_user_id: str) -> VisualAssets:
    return VisualAssets(session, get_settings(), owner_user_id)


def _library_archive(session: SessionDep, owner_user_id: str) -> LibraryFolderArchive:
    return LibraryFolderArchive(session, get_settings(), owner_user_id)


def asset_http_error(exc: AssetError) -> HTTPException:
    return HTTPException(
        exc.status,
        {"code": exc.code, "message": str(exc), **exc.detail},
    )


def archive_http_error(exc: LibraryFolderArchiveError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/file-storage/layout", response_model=StorageLayoutStatusOut)
async def storage_layout_status(
    request: Request, principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep
) -> StorageLayoutStatusOut:
    if getattr(request.app.state, "storage_upgrade_required", False):
        if not principal.is_platform_admin or principal.auth_kind != "session":
            raise HTTPException(403, {"code": "platform_admin_required"})

        state = await upgrade_status(session)
        return StorageLayoutStatusOut(
            account_upgrade_pending=state["pending"],
            restart_required=not state["pending"],
            pending_projects=0,
            pending_assets=0,
            migrated_assets=0,
            pending_bytes=0,
            missing_files=0,
            conflicting_files=state["failed"],
            complete=not state["pending"],
        )
    return await StorageLayoutMigration(session, get_settings(), owner_user_id).status()


@router.post("/file-storage/layout/migrate", response_model=StorageLayoutMigrationOut)
async def migrate_storage_layout(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    limit: int = Query(default=50, ge=1, le=100),
) -> StorageLayoutMigrationOut:
    if getattr(request.app.state, "storage_upgrade_required", False):
        if principal.auth_kind != "session" or not principal.is_platform_admin:
            raise HTTPException(403, {"code": "platform_admin_required"})
        require_recent_reauthentication(principal)

        try:
            state = await migrate_accounts(session, get_settings())
        except AccountUpgradeBusyError:
            raise HTTPException(
                409, {"code": "storage_migration_busy", "message": "文件升级正在执行"}
            ) from None
        return StorageLayoutMigrationOut(
            processed_assets=0,
            migrated_projects=0,
            migrated_assets=0,
            already_materialized_assets=0,
            missing_files=0,
            conflicts=state["failed"],
            remaining_projects=0,
            remaining_assets=0,
            issues=[],
            complete=not state["pending"],
            account_upgrade_pending=state["pending"],
            restart_required=not state["pending"],
        )
    try:
        return await StorageLayoutMigration(session, get_settings(), owner_user_id).migrate(limit)
    except LayoutMigrationBusyError as exc:
        raise HTTPException(409, {"code": "storage_migration_busy", "message": str(exc)}) from None


@router.post("/file-storage/open-folder", response_model=ProjectFolderOpenOut)
async def reveal_library_folder(
    principal: StudioAuth,
    owner_user_id: OwnerDep,
) -> ProjectFolderOpenOut:
    if principal.auth_kind != "session":
        raise HTTPException(
            403,
            {"code": "browser_session_required", "message": "打开文件夹必须使用浏览器 Session"},
        )
    try:
        await open_library_folder(AssetStorage(get_settings()), owner_user_id=owner_user_id)
    except ProjectFolderError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return ProjectFolderOpenOut()


@router.get("/file-library/folder-exports", response_class=FileResponse)
async def export_library_folder_archive(
    session: SessionDep,
    owner_user_id: OwnerDep,
    folder_id: str | None = Query(default=None),
) -> FileResponse:
    try:
        exported = await _library_archive(session, owner_user_id).export_subtree(folder_id)
    except LibraryFolderArchiveError as exc:
        raise archive_http_error(exc) from None
    return FileResponse(
        exported.path,
        media_type="application/zip",
        filename=exported.filename,
        background=BackgroundTask(shutil.rmtree, exported.path.parent, ignore_errors=True),
    )


@router.post("/file-library/folder-archive-imports", response_model=LibraryFolderImportOut)
async def import_library_folder_archive(
    session: SessionDep,
    owner_user_id: OwnerDep,
    archive: Annotated[UploadFile, File()],
    parent_folder_id: Annotated[str | None, Form()] = None,
) -> LibraryFolderImportOut:
    try:
        return await _library_archive(session, owner_user_id).import_archive(
            archive, parent_folder_id=parent_folder_id or None
        )
    except LibraryFolderArchiveError as exc:
        raise archive_http_error(exc) from None


@router.post("/file-library/folder-entry-imports", response_model=LibraryFolderImportOut)
async def import_library_folder_entries(
    session: SessionDep,
    owner_user_id: OwnerDep,
    files: Annotated[list[UploadFile], File()],
    relative_paths: Annotated[list[str], Form()],
    parent_folder_id: Annotated[str | None, Form()] = None,
) -> LibraryFolderImportOut:
    try:
        return await _library_archive(session, owner_user_id).import_entries(
            list(files),
            list(relative_paths),
            parent_folder_id=parent_folder_id or None,
        )
    except LibraryFolderArchiveError as exc:
        raise archive_http_error(exc) from None


@router.post("/file-library/asset-imports", response_model=VisualAssetListOut)
async def import_project_assets_to_library(
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: LibraryAssetImportIn,
) -> VisualAssetListOut:
    try:
        return await _assets(session, owner_user_id).import_project_assets_to_library(body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.get("/file-folders", response_model=VisualAssetFolderListOut)
async def list_file_folders(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str | None = None,
) -> VisualAssetFolderListOut:
    try:
        return await _assets(session, owner_user_id).list_folders(project_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.post("/file-folders", response_model=VisualAssetFolderOut)
async def create_file_folder(
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: VisualAssetFolderCreateIn,
) -> VisualAssetFolderOut:
    try:
        return await _assets(session, owner_user_id).create_folder(body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.patch("/file-folders/{folder_id}", response_model=VisualAssetFolderOut)
async def patch_file_folder(
    session: SessionDep,
    owner_user_id: OwnerDep,
    folder_id: str,
    body: VisualAssetFolderPatchIn,
) -> VisualAssetFolderOut:
    try:
        return await _assets(session, owner_user_id).patch_folder(folder_id, body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.delete("/file-folders/{folder_id}")
async def delete_file_folder(
    session: SessionDep,
    owner_user_id: OwnerDep,
    folder_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _assets(session, owner_user_id).delete_folder(folder_id, expected_revision)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return {"deleted": True}


@router.get("/files", response_model=VisualAssetListOut)
async def list_files(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str | None = None,
    folder_id: str | None = None,
    query: str = Query(default="", max_length=255),
    media_kind: Literal["image", "video", "audio", "font", "document"] | None = None,
    sort: Literal["updated", "name"] = "updated",
    include_references: bool = True,
    include_svg: bool = False,
) -> VisualAssetListOut:
    try:
        return await _assets(session, owner_user_id).list_assets(
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
    owner_user_id: OwnerDep,
    upload: Annotated[UploadFile, File()],
    project_id: Annotated[str | None, Form()] = None,
    folder_id: Annotated[str | None, Form()] = None,
    display_name: Annotated[str | None, Form()] = None,
) -> VisualAssetOut:
    try:
        return await _assets(session, owner_user_id).upload(
            upload,
            project_id=project_id,
            folder_id=folder_id,
            display_name=display_name,
        )
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.patch("/files/{asset_id}", response_model=VisualAssetOut)
async def patch_file(
    session: SessionDep,
    owner_user_id: OwnerDep,
    asset_id: str,
    body: VisualAssetPatchIn,
) -> VisualAssetOut:
    try:
        return await _assets(session, owner_user_id).patch_asset(asset_id, body)
    except AssetError as exc:
        raise asset_http_error(exc) from None


@router.delete("/files/{asset_id}")
async def delete_file(
    session: SessionDep,
    owner_user_id: OwnerDep,
    asset_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _assets(session, owner_user_id).delete_asset(asset_id, expected_revision)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return {"deleted": True}


@router.get("/files/{asset_id}/content", responses={200: {"headers": FILE_CONTENT_HEADERS}})
async def preview_file(session: SessionDep, owner_user_id: OwnerDep, asset_id: str) -> FileResponse:
    try:
        row, path = await _assets(session, owner_user_id).content(asset_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return FileResponse(
        path,
        media_type=row.mime_type,
        filename=row.original_filename,
        content_disposition_type="inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            "X-Fpl-File-Revision": str(row.revision),
            "X-Fpl-File-Kind": row.media_kind,
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
    owner_user_id: OwnerDep,
    asset_id: str,
    download_name: str | None = Query(default=None, max_length=255),
) -> FileResponse:
    try:
        row, path = await _assets(session, owner_user_id).content(asset_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return FileResponse(
        path,
        media_type=row.mime_type,
        filename=download_filename(download_name or row.display_name, row.original_filename),
    )


@router.post("/files/svg/preview", response_model=SvgPreviewOut)
async def preview_svg(body: SvgPreviewIn, _owner_user_id: OwnerDep) -> SvgPreviewOut:
    from studio.runtime.files.svg import normalize_svg

    try:
        return SvgPreviewOut(**normalize_svg(body.svg))
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_svg", "message": str(exc)}) from None
