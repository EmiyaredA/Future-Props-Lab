"""Move and verify account-owned Director project and motion bytes."""

import asyncio
import hashlib
import json
from typing import Annotated
from uuid import UUID, uuid5

from fastapi import HTTPException, Request
from fastapi import Path as RoutePath
from fastapi.responses import FileResponse

from studio.apps.director_desk.schemas import FILE_KEY
from studio.apps.director_desk.storage.migration_files import (
    DirectorFile,
    DirectorFiles,
    invalid_file,
    measure,
)
from studio.apps.director_desk.storage.migration_records import ID
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.http.migration_admission import MigrationAdmission

FILES = "/v1/migration/director/files"
DATASET = "director.files"
FileScope = Annotated[str, RoutePath(pattern=rf"^(?:library|{ID[1:-1]})$")]
FileDigest = Annotated[str, RoutePath(pattern=FILE_KEY.pattern)]


def receipt_for(plan, owner, file):
    return BatchReceipt(
        run_id=plan.run_id,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{file.scope}/{file.sha256}"),
        dataset=DATASET,
        sha256=hashlib.sha256(
            json.dumps(file.model_dump(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        record_count=1,
    )


def mount_files(app, plan, sessions, *, root, source=None):
    admission = MigrationAdmission(plan)
    files = DirectorFiles(root, sessions)

    def check_source():
        if source is not None:
            try:
                source.check()
            except (ValueError, OSError):
                raise HTTPException(409, {"code": "migration_source_changed"}) from None

    @app.get(FILES)
    async def verify_owners():
        check_source()
        try:
            await asyncio.to_thread(files.check_owners, {str(owner) for owner in plan.owner_ids})
        except (OSError, ValueError):
            raise invalid_file() from None
        check_source()
        return {"verified": True}

    @app.get(f"{FILES}/{{owner}}", response_model=list[DirectorFile])
    async def list_files(owner: UUID, complete: bool = False):
        admission.check_owner(owner)
        check_source()
        result = await files.inventory(owner, complete=complete or source is not None)
        check_source()
        return result

    @app.get(f"{FILES}/{{owner}}/{{scope}}/{{digest}}")
    async def download(owner: UUID, scope: FileScope, digest: FileDigest):
        admission.check_owner(owner)
        check_source()
        await files.validate_scope(owner, scope)
        try:
            path = files.blob(owner, scope, digest)
            await asyncio.to_thread(measure, path, scope, digest)
        except (OSError, ValueError):
            raise invalid_file() from None
        check_source()
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(f"{FILES}/{{owner}}/{{scope}}/{{digest}}", response_model=BatchReceipt)
        async def import_file(owner: UUID, scope: FileScope, digest: FileDigest, request: Request):
            admission.check_owner(owner)
            file = await files.store(request, owner, scope, digest)
            receipt = receipt_for(plan, owner, file)
            await files.record(receipt)
            return receipt
