"""Transfer Models catalog and owned history using the destination encryption key."""

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
from studio.apps.model_service.storage.migration_history import DATASETS as HISTORY
from studio.apps.model_service.storage.migration_originals import ATTACHMENTS, INFERENCE
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.transport.migration_originals_http import (
    mount_inference_relationships,
    mount_originals,
)
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset
from studio.runtime.database.project_history_migration import mount_project_history

PREFIX = "/v1/migration/models"
TRANSPORT = {"maximum": 32 * 1024 * 1024, "streaming_prefix": INFERENCE.prefix + "/"}


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


def mount_history(app, plan, sessions, *, root, source=None):
    mount_project_history(app, plan, sessions, PREFIX, HISTORY, ModelsImportReceipt, source=source)
    mount_inference_relationships(app, sessions, source=source)
    for scope in (INFERENCE, ATTACHMENTS):
        mount_originals(app, plan, sessions, scope, root=root, source=source)


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_history(app, plan, sessions, root=source.path.parent, source=source)
    return mount_catalog(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root, secret_key):
    cipher = SecretCipher(secret_key)
    models = (
        *(dataset.model for dataset in (*DATASETS, *HISTORY)),
        *settings.MODELS,
        ModelsImportReceipt,
    )
    app, database = import_app(plan, state_root, "models", models, MIGRATIONS, **TRANSPORT)
    mount_history(app, plan, database.sessions, root=database.root)
    return mount_catalog(app, plan, database.sessions, cipher=cipher)
