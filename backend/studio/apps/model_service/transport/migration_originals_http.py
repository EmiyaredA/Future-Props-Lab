"""Expose Models file inventories and streams in maintenance only."""

import asyncio
from uuid import UUID

from fastapi import Request
from fastapi.responses import FileResponse

from studio.apps.model_service.storage.migration_inference import verify_inputs
from studio.apps.model_service.storage.migration_originals import (
    Kind,
    ModelOriginals,
    Original,
)
from studio.apps.model_service.storage.migration_playground_tasks import verify_references
from studio.contracts.management.migration_batches import BatchReceipt
from studio.contracts.management.project_history import Identifier
from studio.runtime.database.project_history_migration import blocked
from studio.runtime.http.migration_admission import MigrationAdmission

RELATIONSHIPS = "/v1/migration/models/inference-relationships"
TEST_RELATIONSHIPS = "/v1/migration/models/test-generation-relationships"


def check_source(source):
    if source is not None:
        try:
            source.check()
        except (OSError, ValueError):
            raise blocked("migration_source_changed") from None


def mount_relationships(app, sessions, *, source=None):
    @app.get(RELATIONSHIPS)
    async def relationships():
        check_source(source)
        result = await verify_inputs(sessions)
        check_source(source)
        return result

    @app.get(TEST_RELATIONSHIPS)
    async def test_references():
        check_source(source)
        result = await verify_references(sessions)
        check_source(source)
        return result


def mount_originals(app, plan, sessions, scope, *, root, source=None):
    originals = ModelOriginals(plan, sessions, root, scope, legacy=source is not None)
    admission = MigrationAdmission(plan)
    prefix = scope.prefix
    file_route = prefix + "/{owner}/{kind}/{identifier}/{size}/{digest}"
    inventory_error = f"migration_{scope.name.replace('-', '_')}_file_inventory_conflict"
    file_error = f"migration_{scope.name.replace('-', '_')}_file_unavailable"

    def check(owner=None):
        if owner is not None:
            admission.check_owner(owner)
        check_source(source)

    @app.get(prefix)
    async def accounts():
        check()
        try:
            await asyncio.to_thread(originals.check_owners)
        except (ValueError, OSError):
            raise blocked(inventory_error) from None
        check()
        return {"verified": True}

    @app.get(prefix + "/{owner}", response_model=list[Original])
    async def inventory(owner: UUID, complete: bool = False):
        check(owner)
        try:
            files = await originals.manifest(owner, complete=complete)
        except (ValueError, OSError):
            raise blocked(inventory_error) from None
        check(owner)
        return files

    @app.get(file_route)
    async def read(owner: UUID, kind: Kind, identifier: Identifier, size: int, digest: str):
        check(owner)
        try:
            item = Original(kind=kind, id=identifier, size=size, sha256=digest)
            path = await originals.read(owner, item)
        except (ValueError, OSError):
            raise blocked(file_error) from None
        check(owner)
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(file_route, response_model=BatchReceipt)
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
                raise blocked(file_error) from None
