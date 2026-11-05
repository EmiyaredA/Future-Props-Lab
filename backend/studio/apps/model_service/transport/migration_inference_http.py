"""Expose inference relationship and streaming original checks in maintenance only."""

import asyncio
from uuid import UUID

from fastapi import Request
from fastapi.responses import FileResponse

from studio.apps.model_service.storage.migration_inference import verify_inputs
from studio.apps.model_service.storage.migration_inference_files import (
    PREFIX,
    InferenceOriginals,
    Kind,
    Original,
)
from studio.contracts.management.migration_batches import BatchReceipt
from studio.contracts.management.project_history import Identifier
from studio.runtime.database.project_history_migration import blocked
from studio.runtime.http.migration_admission import MigrationAdmission

RELATIONSHIPS = "/v1/migration/models/inference-relationships"
FILE = PREFIX + "/{owner}/{kind}/{identifier}/{size}/{digest}"


def mount_inference(app, plan, sessions, *, root, source=None):
    originals = InferenceOriginals(plan, sessions, root, legacy=source is not None)
    admission = MigrationAdmission(plan)

    def check(owner=None):
        if owner is not None:
            admission.check_owner(owner)
        if source is not None:
            try:
                source.check()
            except (OSError, ValueError):
                raise blocked("migration_source_changed") from None

    @app.get(RELATIONSHIPS)
    async def relationships():
        check()
        result = await verify_inputs(sessions)
        check()
        return result

    @app.get(PREFIX)
    async def accounts():
        check()
        try:
            await asyncio.to_thread(originals.check_owners)
        except (ValueError, OSError):
            raise blocked("migration_inference_file_inventory_conflict") from None
        check()
        return {"verified": True}

    @app.get(PREFIX + "/{owner}", response_model=list[Original])
    async def inventory(owner: UUID, complete: bool = False):
        check(owner)
        try:
            files = await originals.manifest(owner, complete=complete)
        except (ValueError, OSError):
            raise blocked("migration_inference_file_inventory_conflict") from None
        check(owner)
        return files

    @app.get(FILE)
    async def read(owner: UUID, kind: Kind, identifier: Identifier, size: int, digest: str):
        check(owner)
        try:
            item = Original(kind=kind, id=identifier, size=size, sha256=digest)
            path = await originals.read(owner, item)
        except (ValueError, OSError):
            raise blocked("migration_inference_file_unavailable") from None
        check(owner)
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(FILE, response_model=BatchReceipt)
        async def save(
            request: Request,
            owner: UUID,
            kind: Kind,
            identifier: Identifier,
            size: int,
            digest: str,
        ):
            check(owner)
            try:
                item = Original(kind=kind, id=identifier, size=size, sha256=digest)
                return await originals.save(request.stream(), owner, item)
            except (ValueError, OSError):
                raise blocked("migration_inference_file_unavailable") from None
