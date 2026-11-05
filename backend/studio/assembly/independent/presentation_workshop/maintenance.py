"""Loopback-only Presentation record export and import on isolated state."""

from functools import partial

from studio.apps.presentation_workshop import migration_operations as operations
from studio.apps.presentation_workshop.migration_references import (
    export_projections,
    inventory_projections,
)
from studio.apps.presentation_workshop.storage.migration_records import (
    DATASETS,
    export_page,
    import_batch,
    inventory,
)
from studio.apps.presentation_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.presentation_workshop.storage.service_models import PresentationMigrationReceipt
from studio.contracts.presentation_workshop.presentation_migration import (
    ID,
    REFERENCE_DATASETS,
    ProjectionBatch,
    ProjectionPage,
)
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset
from studio.runtime.database.project_operations import ProjectOperationReceipt

PREFIX = "/v1/migration/presentation"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount_records(app, plan, sessions, *, source=None):
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.name.split('.')[1]}",
            plan=plan,
            cursor_pattern=ID,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset.model),
            page=partial(export_page, sessions, plan, dataset),
            ingest=partial(import_batch, sessions, dataset) if source is None else None,
            source=source,
        )
    mount_dataset(
        app,
        prefix=PREFIX + "/operation-receipts",
        plan=plan,
        cursor_pattern=operations.CURSOR,
        batch_model=operations.OperationBatch,
        page_model=operations.OperationPage,
        inventory=partial(operations.inventory, sessions, plan),
        page=partial(operations.export_page, sessions, plan),
        ingest=partial(operations.ingest, sessions) if source is None else None,
        source=source,
    )
    if source is not None:
        for dataset, kind in REFERENCE_DATASETS.items():
            mount_dataset(
                app,
                prefix=f"{PREFIX}/{dataset.split('.')[1]}",
                plan=plan,
                cursor_pattern=ID,
                batch_model=ProjectionBatch,
                page_model=ProjectionPage,
                inventory=partial(inventory_projections, sessions, plan, kind),
                page=partial(export_projections, sessions, plan, dataset),
                source=source,
            )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (
        *[dataset.model for dataset in DATASETS],
        ProjectOperationReceipt,
        PresentationMigrationReceipt,
    )
    app, database = import_app(plan, state_root, "presentation", models, MIGRATIONS, **TRANSPORT)
    return mount_records(app, plan, database.sessions)
