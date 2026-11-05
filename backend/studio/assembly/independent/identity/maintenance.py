"""Explicit Identity maintenance, separate from the published authentication API."""

from functools import partial

from studio.apps.identity.avatar_migration import mount_avatars
from studio.apps.identity.credential_migration import (
    DATASETS,
    UUID_PATTERN,
    export_page,
    import_batch,
    inventory,
)
from studio.apps.identity.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.storage.service_models import IdentityImportReceipt
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset

PREFIX = "/v1/migration/identity"


def _mount(app, plan, sessions, *, source=None, database=None):
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.path}",
            plan=plan,
            cursor_pattern=UUID_PATTERN,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset, legacy=source is not None),
            page=partial(export_page, sessions, plan, dataset, legacy=source is not None),
            ingest=partial(import_batch, database, plan, dataset) if database is not None else None,
            source=source,
            platform=dataset.platform,
        )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path)
    mount_avatars(app, plan, sessions, source.path.parent / "profiles", source=source)
    return _mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*[dataset.model for dataset in DATASETS], IdentityImportReceipt)
    app, database = import_app(plan, state_root, "identity", models, MIGRATIONS, account_models=())
    mount_avatars(app, plan, database.sessions, database.root / "profiles")
    return _mount(app, plan, database.sessions, database=database)
