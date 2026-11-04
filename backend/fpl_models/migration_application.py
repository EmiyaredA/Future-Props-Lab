"""Explicit Models catalog transfer with the destination encryption key."""

from functools import partial

from app.runtime.credentials import SecretCipher
from fpl_runtime.migration_apps import export_app, import_app, mount_dataset

from .catalog_migration import (
    DATASETS,
    UUID_PATTERN,
    ModelsImportReceipt,
    export_page,
    import_batch,
    inventory,
)
from .migrations.registry import MIGRATIONS

PREFIX = "/v1/migration/models"


def mount_catalog(app, plan, sessions, *, source=None, cipher=None):
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.name.split('.')[1]}",
            plan=plan,
            cursor_pattern=UUID_PATTERN,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset),
            page=partial(export_page, sessions, plan, dataset),
            ingest=partial(import_batch, sessions, dataset, cipher) if source is None else None,
            source=source,
        )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path)
    return mount_catalog(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root, secret_key):
    cipher = SecretCipher(secret_key)
    models = (*[dataset.model for dataset in DATASETS], ModelsImportReceipt)
    app, database = import_app(plan, state_root, "models", models, MIGRATIONS)
    return mount_catalog(app, plan, database.sessions, cipher=cipher)
