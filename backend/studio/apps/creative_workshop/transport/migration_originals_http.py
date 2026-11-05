"""Private streaming routes for Creative's cover and Skill originals."""

from uuid import UUID

from fastapi import Depends, Query, Request
from fastapi.responses import FileResponse

from studio.apps.creative_workshop.storage.migration_originals import PREFIX, Original, Originals
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.database.project_history_migration import blocked
from studio.runtime.http.migration_admission import MigrationAdmission

OWNER = PREFIX + "/{owner}"


def query_file(
    path: str = Query(min_length=1, max_length=4096),
    size: int = Query(ge=0),
    sha256: str = Query(pattern=r"^[0-9a-f]{64}$"),
):
    return Original(path=path, size=size, sha256=sha256)


def mount_originals(app, plan, sessions, *, root, source):
    files = Originals(plan, sessions, root)
    admission = MigrationAdmission(plan)

    def check(owner):
        admission.check_owner(owner)
        if source is not None:
            try:
                source.check()
            except (OSError, ValueError):
                raise blocked("migration_source_changed") from None

    @app.get(OWNER + "/inventory", response_model=list[Original])
    async def inventory(owner: UUID, complete: bool = False):
        check(owner)
        try:
            result = await files.manifest(
                owner,
                complete=complete or source is not None,
                require_receipts=complete and source is None,
            )
        except (OSError, ValueError):
            raise blocked("migration_creative_original_inventory_conflict") from None
        check(owner)
        return result

    @app.get(OWNER + "/file")
    async def read(owner: UUID, file: Original = Depends(query_file)):
        check(owner)
        try:
            path = await files.read(owner, file)
        except (OSError, ValueError):
            raise blocked("migration_creative_original_unavailable") from None
        check(owner)
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(OWNER + "/file", response_model=BatchReceipt)
        async def save(request: Request, owner: UUID, file: Original = Depends(query_file)):
            check(owner)
            try:
                return await files.save(request.stream(), owner, file)
            except (OSError, ValueError):
                raise blocked("migration_creative_original_unavailable") from None
