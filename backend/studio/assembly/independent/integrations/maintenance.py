"""Explicit read-only catalogue export and Integrations-owned import."""

from app.runtime.credentials import SecretCipher
from studio.apps.integrations.storage.catalog_migration import (
    DATASETS,
    IntegrationsImportReceipt,
    verified_catalog,
)
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.runtime.database.migration_apps import export_app, import_app
from studio.runtime.database.project_history_migration import mount_project_history

PREFIX = "/v1/migration/integrations"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, IntegrationsImportReceipt, source=source
    )
    return app


def create_import_app(*, plan, state_root, secret_key):
    datasets = verified_catalog(SecretCipher(secret_key))
    models = (*(dataset.model for dataset in datasets), IntegrationsImportReceipt)
    app, db = import_app(plan, state_root, "integrations", models, MIGRATIONS, **TRANSPORT)
    mount_project_history(app, plan, db.sessions, PREFIX, datasets, IntegrationsImportReceipt)
    return app
