"""Assemble Director's loopback-only record and streaming file maintenance."""

from functools import partial

from fpl_runtime.migration_apps import export_app, import_app, mount_dataset

from .migration_files import FILES, mount_files
from .migration_receipts import DirectorImportReceipt
from .migration_records import DATASETS, ID, export_page, import_batch, inventory
from .migrations.registry import MIGRATIONS

PREFIX = "/v1/migration/director"
TRANSPORT = {"maximum": 32 * 1024 * 1024, "streaming_prefix": FILES + "/"}


def mount_records(app, plan, sessions, *, source=None):
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.name.split('.')[1]}",
            plan=plan,
            cursor_pattern=ID,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset),
            page=partial(export_page, sessions, plan, dataset),
            ingest=partial(import_batch, sessions, dataset) if source is None else None,
            source=source,
        )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_files(app, plan, sessions, root=source.path.parent, source=source)
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*[dataset.model for dataset in DATASETS], DirectorImportReceipt)
    app, database = import_app(plan, state_root, "director", models, MIGRATIONS, **TRANSPORT)
    mount_files(app, plan, database.sessions, root=database.root)
    return mount_records(app, plan, database.sessions)
