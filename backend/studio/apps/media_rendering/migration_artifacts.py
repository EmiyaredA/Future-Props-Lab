"""Import verified historical render output and activate its exact owned receipt."""

from uuid import UUID

from fastapi import Request

from studio.apps.media_rendering.storage.historical_media import HistoricalMedia
from studio.apps.media_rendering.storage.migrations.registry import MIGRATIONS
from studio.apps.media_rendering.storage.service_models import (
    MotionRenderJob,
    RenderingHistoryManifest,
    RenderingMigrationReceipt,
    VideoMediaJob,
)
from studio.contracts.management.editing_artifacts import (
    MOTION_DATASET,
    MOTION_PREFIX,
    VIDEO_DATASET,
    VIDEO_PREFIX,
    MotionRenderBatch,
    MotionRenderHistory,
    MotionRenderPage,
    VideoDerivativeBatch,
    VideoDerivativeHistory,
    VideoDerivativePage,
)
from studio.runtime.database.migration_apps import import_app, mount_dataset
from studio.runtime.database.project_history_migration import CURSOR
from studio.runtime.http.migration_admission import MigrationAdmission

DATASETS = (
    (MOTION_DATASET, MOTION_PREFIX, MotionRenderHistory, MotionRenderBatch, MotionRenderPage),
    (
        VIDEO_DATASET,
        VIDEO_PREFIX,
        VideoDerivativeHistory,
        VideoDerivativeBatch,
        VideoDerivativePage,
    ),
)


def mount_files(app, plan, prefix, media):
    admission = MigrationAdmission(plan)
    path = prefix + "/files/{owner_id}/{record_id}/{key}/{sha256}"

    @app.put(path)
    async def write_file(request: Request, owner_id: UUID, record_id: str, key: str, sha256: str):
        admission.check_owner(owner_id)
        record, file = await media.lookup(owner_id, record_id, key, sha256)
        return await media.store(request, owner_id, record, file)

    @app.head(path)
    async def verify_file(owner_id: UUID, record_id: str, key: str, sha256: str):
        admission.check_owner(owner_id)
        record, file = await media.lookup(owner_id, record_id, key, sha256)
        return await media.verify(owner_id, record, file)


def create_import_app(*, plan, state_root):
    models = (MotionRenderJob, VideoMediaJob, RenderingHistoryManifest, RenderingMigrationReceipt)
    app, database = import_app(
        plan,
        state_root,
        "rendering",
        models,
        MIGRATIONS,
        streaming_prefix=tuple(prefix + "/files/" for _dataset, prefix, *_spec in DATASETS),
    )
    for dataset, prefix, record, batch, page in DATASETS:
        media = HistoricalMedia(plan, database, dataset, record, batch, page)
        mount_dataset(
            app,
            prefix=prefix,
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=batch,
            page_model=page,
            inventory=media.inventory,
            page=media.page,
            ingest=media.ingest,
        )
        mount_files(app, plan, prefix, media)
    return app
