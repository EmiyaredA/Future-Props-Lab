import sys
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.deps import StudioAuth
from app.runtime.website import require_local_browser
from app.tool_navigation.storage_usage import (
    StorageUsageError,
    open_storage_directory,
    read_storage_usage,
)
from app.tool_navigation.storage_usage_schemas import (
    StorageDirectoryIn,
    StorageOpenReceipt,
    StorageUsageState,
)

router = APIRouter(prefix="/tool-navigation/storage-usage", tags=["tool-navigation"])


def require_storage_access(request: Request, principal: StudioAuth) -> None:
    require_local_browser(request, principal)
    if sys.platform != "darwin":
        raise HTTPException(404, detail="空间占用工具仅支持 macOS")
    if principal.auth_kind != "session" or not principal.is_platform_admin:
        raise HTTPException(403, detail="仅本机网站平台管理员可使用空间占用工具")


@router.get("", response_model=StorageUsageState)
def get_storage_usage(
    request: Request,
    principal: StudioAuth,
    directory: Annotated[str | None, Query(min_length=1, max_length=4096)] = None,
) -> StorageUsageState:
    require_storage_access(request, principal)
    try:
        return read_storage_usage(directory)
    except StorageUsageError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/analyze", response_model=StorageOpenReceipt)
def analyze_storage_directory(
    request: Request, principal: StudioAuth, body: StorageDirectoryIn
) -> StorageOpenReceipt:
    require_storage_access(request, principal)
    try:
        return open_storage_directory(body.directory, analyze=True)
    except StorageUsageError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/open-directory", response_model=StorageOpenReceipt)
def open_directory(
    request: Request, principal: StudioAuth, body: StorageDirectoryIn
) -> StorageOpenReceipt:
    require_storage_access(request, principal)
    try:
        return open_storage_directory(body.directory, analyze=False)
    except StorageUsageError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
