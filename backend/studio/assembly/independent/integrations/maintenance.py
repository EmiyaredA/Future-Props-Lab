"""Explicit read-only catalogue export and Integrations-owned import."""

from app.runtime.credentials import SecretCipher
from studio.apps.integrations.storage.catalog_migration import (
    DATASETS as CATALOG,
)
from studio.apps.integrations.storage.catalog_migration import (
    IntegrationsImportReceipt,
    verified_catalog,
)
from studio.apps.integrations.storage.migration_creative_parts import (
    DATA as CREATIVE_PARTS,
)
from studio.apps.integrations.storage.migration_skills import SKILLS, VERSIONS
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.apps.integrations.transport.migration_creative_parts_http import (
    mount_source_presence,
    mount_target,
)
from studio.apps.integrations.transport.skill_originals_migration_http import mount_skill_originals
from studio.contracts.integrations.skill_migration import PREFIX as ORIGINALS
from studio.runtime.database.migration_apps import export_app, import_app
from studio.runtime.database.project_history_migration import mount_project_history

PREFIX = "/v1/migration/integrations"
TRANSPORT = {"maximum": 32 * 1024 * 1024, "streaming_prefix": ORIGINALS + "/"}
DATASETS = (*CATALOG, SKILLS, VERSIONS)


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, IntegrationsImportReceipt, source=source
    )
    mount_skill_originals(app, plan, sessions, root=source.path.parent, source=source)
    mount_source_presence(app, plan, sessions, source)
    return app


def create_import_app(*, plan, state_root, secret_key):
    datasets = (*verified_catalog(SecretCipher(secret_key)), SKILLS, VERSIONS)
    models = (
        *(dataset.model for dataset in datasets),
        CREATIVE_PARTS.model,
        IntegrationsImportReceipt,
    )
    app, db = import_app(plan, state_root, "integrations", models, MIGRATIONS, **TRANSPORT)
    mount_project_history(app, plan, db.sessions, PREFIX, datasets, IntegrationsImportReceipt)
    mount_skill_originals(app, plan, db.sessions, root=db.root)
    mount_target(app, plan, db.sessions, IntegrationsImportReceipt)
    return app
