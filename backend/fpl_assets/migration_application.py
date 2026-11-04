"""Separate loopback maintenance app for Assets folders, records and originals."""

from functools import partial

from fpl_runtime.migration_apps import export_app, import_app, mount_dataset

from .migration_blobs import BLOBS, mount_blobs
from .migration_editing_scopes import mount_project_scopes
from .migration_models import MIGRATION_MODELS
from .migration_project_pins import mount_galgame_references, mount_presentation_references
from .migration_records import DATASETS, export_page, import_batch, inventory
from .migration_video_outputs import mount_video_outputs
from .migrations.registry import MIGRATIONS
from .models import (
    AssetReferencePin,
    AssetReferenceSet,
    VideoFileWriteReceipt,
)

PREFIX = "/v1/migration/assets"
TRANSPORT = {"streaming_prefix": BLOBS + "/"}


def mount_records(app, plan, sessions, *, source=None):
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.name.split('.')[1]}",
            plan=plan,
            cursor_pattern=dataset.cursor,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset),
            page=partial(export_page, sessions, plan, dataset),
            ingest=partial(import_batch, sessions, dataset) if source is None else None,
            source=source,
        )
    mount_project_scopes(app, plan, sessions, source=source)
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_blobs(app, plan, sessions, root=source.path.parent, source=source)
    mount_video_outputs(app, plan, sessions, source.path.parent, source=source)
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (
        *[dataset.model for dataset in DATASETS],
        *MIGRATION_MODELS,
        AssetReferenceSet,
        AssetReferencePin,
        VideoFileWriteReceipt,
    )
    app, database = import_app(plan, state_root, "assets", models, MIGRATIONS, **TRANSPORT)
    mount_blobs(app, plan, database.sessions, root=database.root)
    mount_presentation_references(app, plan, database.sessions)
    mount_galgame_references(app, plan, database.sessions)
    mount_video_outputs(app, plan, database.sessions, database.root)
    return mount_records(app, plan, database.sessions)
