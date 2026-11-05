"""Owned storage upgrade retains the existing public paths and response contracts."""

from fastapi import APIRouter, Query, Request

from studio.contracts.asset_library.files import StorageLayoutMigrationOut, StorageLayoutStatusOut
from studio.runtime.http.dependencies import OwnerDep

router = APIRouter(tags=["file-management"])


@router.get("/file-storage/layout", response_model=StorageLayoutStatusOut)
async def storage_layout_status(
    request: Request, owner_user_id: OwnerDep
) -> StorageLayoutStatusOut:
    return await request.app.state.layouts.status(owner_user_id)


@router.post("/file-storage/layout/migrate", response_model=StorageLayoutMigrationOut)
async def migrate_storage_layout(
    request: Request,
    owner_user_id: OwnerDep,
    limit: int = Query(default=50, ge=1, le=100),
) -> StorageLayoutMigrationOut:
    return await request.app.state.layouts.migrate(owner_user_id, limit)
