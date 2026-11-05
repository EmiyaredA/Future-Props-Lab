"""Private loopback routes for streamed Amadeus originals."""

import asyncio
from typing import Literal
from uuid import UUID

from fastapi import Depends, Query, Request
from fastapi.responses import FileResponse

from studio.apps.amadeus.storage.migration_originals import PREFIX, Original, WorkingOriginals
from studio.contracts.management.migration_batches import BatchReceipt
from studio.contracts.management.project_history import Identifier
from studio.runtime.database.project_history_migration import blocked
from studio.runtime.http.migration_admission import MigrationAdmission

OWNER = PREFIX + "/{owner}"
FILE = OWNER + "/file"


def query_file(
    conversation_id: Identifier,
    path: str = Query(min_length=1, max_length=4096),
    kind: Literal["imports", "scripts", "outputs", "skills"] = Query(),
    size: int = Query(ge=0),
    sha256: str = Query(pattern=r"^[a-f0-9]{64}$"),
):
    try:
        return Original(
            conversation_id=conversation_id, path=path, kind=kind, size=size, sha256=sha256
        )
    except ValueError:
        raise blocked("migration_amadeus_original_descriptor_invalid") from None


def mount_originals(app, plan, sessions, *, root, source=None):
    originals = WorkingOriginals(plan, sessions, root)
    admission = MigrationAdmission(plan)

    def check(owner=None):
        if owner is not None:
            admission.check_owner(owner)
        if source is not None:
            try:
                source.check()
            except (OSError, ValueError):
                raise blocked("migration_source_changed") from None

    @app.get(PREFIX)
    async def accounts():
        check()
        try:
            await asyncio.to_thread(originals.check_owners)
        except (OSError, ValueError):
            raise blocked("migration_amadeus_original_inventory_conflict") from None
        check()
        return {"verified": True}

    @app.get(OWNER + "/inventory", response_model=list[Original])
    async def inventory(owner: UUID, complete: bool = False):
        check(owner)
        try:
            files = await originals.manifest(
                owner,
                complete=complete or source is not None,
                require_receipts=complete and source is None,
            )
        except (OSError, ValueError):
            raise blocked("migration_amadeus_original_inventory_conflict") from None
        check(owner)
        return files

    @app.get(FILE)
    async def read(owner: UUID, file: Original = Depends(query_file)):
        check(owner)
        try:
            path = await originals.read(owner, file)
        except (OSError, ValueError):
            raise blocked("migration_amadeus_original_unavailable") from None
        check(owner)
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(FILE, response_model=BatchReceipt)
        async def save(request: Request, owner: UUID, file: Original = Depends(query_file)):
            check(owner)
            try:
                return await originals.save(request.stream(), owner, file)
            except (OSError, ValueError):
                raise blocked("migration_amadeus_original_unavailable") from None
