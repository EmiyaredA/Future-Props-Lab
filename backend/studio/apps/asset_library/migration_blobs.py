"""Expose and import only frozen, owned asset bytes with exact SHA256 receipts."""

import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi import Path as RoutePath
from fastapi.responses import FileResponse

from studio.apps.asset_library.storage.migration_blobs import (
    DIGEST,
    AssetBlob,
    AssetBlobs,
)
from studio.apps.asset_library.storage.migration_records import ASSET_CURSOR
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.http.migration_admission import MigrationAdmission

BLOBS = "/v1/migration/assets/blobs"
AssetParam = Annotated[str, RoutePath(pattern=ASSET_CURSOR)]
DigestParam = Annotated[str, RoutePath(pattern=DIGEST)]


def mount_blobs(app, plan, sessions, *, root, source=None):
    admission = MigrationAdmission(plan)
    blobs = AssetBlobs(root, sessions)

    def ensure_source():
        if source is not None:
            try:
                source.check()
            except (ValueError, OSError):
                raise HTTPException(409, {"code": "migration_source_changed"}) from None

    @app.get(BLOBS)
    async def accounts():
        ensure_source()
        try:
            await asyncio.to_thread(blobs.verify_owners, {str(owner) for owner in plan.owner_ids})
        except (ValueError, OSError):
            raise HTTPException(409, {"code": "migration_asset_inventory_conflict"}) from None
        ensure_source()
        return {"verified": True}

    @app.get(BLOBS + "/{owner}", response_model=list[AssetBlob])
    async def inventory(owner: UUID, complete: bool = False):
        admission.check_owner(owner)
        ensure_source()
        try:
            result = await blobs.inventory(
                owner, complete=complete or source is not None, legacy=source is not None
            )
        except (OSError, ValueError):
            raise HTTPException(409, {"code": "migration_asset_inventory_conflict"}) from None
        ensure_source()
        return result

    @app.get(BLOBS + "/{owner}/{asset}/{digest}")
    async def original(owner: UUID, asset: AssetParam, digest: DigestParam):
        admission.check_owner(owner)
        ensure_source()
        row = await blobs.row(owner, asset)
        try:
            entry, path = await asyncio.to_thread(blobs.measure, row)
        except (OSError, ValueError):
            raise HTTPException(409, {"code": "migration_asset_bytes_changed"}) from None
        if entry.sha256 != digest:
            raise HTTPException(409, {"code": "migration_asset_bytes_changed"})
        ensure_source()
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(BLOBS + "/{owner}/{asset}/{digest}", response_model=BatchReceipt)
        async def ingest(owner: UUID, asset: AssetParam, digest: DigestParam, request: Request):
            admission.check_owner(owner)
            try:
                return await blobs.store(request, plan, owner, asset, digest)
            except (OSError, ValueError):
                raise HTTPException(409, {"code": "migration_asset_bytes_changed"}) from None
