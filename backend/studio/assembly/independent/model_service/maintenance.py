"""Explicit Models catalog transfer with the destination encryption key."""

from functools import partial

from app.runtime.credentials import SecretCipher
from studio.apps.model_service import settings_migration as settings
from studio.apps.model_service.catalog_migration import (
    DATASETS,
    UUID_PATTERN,
    ModelsImportReceipt,
    export_page,
    import_batch,
    inventory,
)
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset

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
    legacy = source is not None
    for dataset in settings.SETTINGS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.name.split('.')[1]}",
            plan=plan,
            cursor_pattern=settings.CURSOR,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(settings.inventory, sessions, plan, dataset, legacy=legacy),
            page=partial(settings.export_page, sessions, plan, dataset, legacy=legacy),
            ingest=partial(settings.import_batch, sessions, dataset, cipher)
            if not legacy
            else None,
            source=source,
            platform=dataset.platform,
        )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path)
    return mount_catalog(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root, secret_key):
    cipher = SecretCipher(secret_key)
    models = (*[dataset.model for dataset in DATASETS], *settings.MODELS, ModelsImportReceipt)
    app, database = import_app(plan, state_root, "models", models, MIGRATIONS)
    return mount_catalog(app, plan, database.sessions, cipher=cipher)
