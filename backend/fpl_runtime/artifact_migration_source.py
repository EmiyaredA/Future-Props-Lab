"""Read exact artifact bytes over the sealed source maintenance listener."""

import asyncio
from uuid import UUID, uuid5

from fastapi import HTTPException
from fastapi.responses import FileResponse

from .editing_artifacts import MAX_ARTIFACT_BYTES
from .migration_apps import mount_dataset
from .migration_batches import MigrationAdmission
from .migration_files import inspect_blob
from .project_history_migration import CURSOR


def artifact_page(plan, owner, after, dataset, batch_type, page_type, records, *, more):
    batch = batch_type(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset}/{owner}/{after or ''}"),
        records=records,
    )
    return page_type(batch=batch, sha256=batch.digest, next_cursor=records[-1].id if more else None)


def mount_artifact_source(
    app, plan, source, *, prefix, batch, page_model, inventory, page, resolve, invalid_code
):
    mount_dataset(
        app,
        prefix=prefix,
        plan=plan,
        cursor_pattern=CURSOR,
        batch_model=batch,
        page_model=page_model,
        inventory=inventory,
        page=page,
        source=source,
    )
    admission = MigrationAdmission(plan)

    @app.get(prefix + "/files/{owner_id}/{record_id}/{key}/{sha256}")
    async def read_file(owner_id: UUID, record_id: str, key: str, sha256: str):
        admission.check_owner(owner_id)
        try:
            source.check()
            path = await resolve(str(owner_id), record_id, key)
            _, actual = await asyncio.to_thread(inspect_blob, path, maximum=MAX_ARTIFACT_BYTES)
            if actual != sha256:
                raise ValueError("历史渲染文件摘要不符")
            source.check()
        except (OSError, ValueError):
            raise HTTPException(409, {"code": invalid_code}) from None
        return FileResponse(path, media_type="application/octet-stream")
