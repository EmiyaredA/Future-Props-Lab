"""Serve the Remote-owned migration dataset only on a maintenance listener."""

from functools import partial

from studio.apps.remote_desktop.preference_migration import (
    OWNER_ID,
    PreferenceBatch,
    PreferencePage,
    export_page,
    import_batch,
    inventory,
)
from studio.apps.remote_desktop.storage.migrations.registry import MIGRATIONS
from studio.apps.remote_desktop.storage.preference_models import DesktopPreference
from studio.apps.remote_desktop.storage.service_models import DesktopPreferenceImportReceipt
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset

PREFIX = "/v1/migration/remote/desktop-preferences"


def _mount(app, plan, sessions, *, source=None, database=None):
    mount_dataset(
        app,
        prefix=PREFIX,
        plan=plan,
        cursor_pattern=OWNER_ID,
        batch_model=PreferenceBatch,
        page_model=PreferencePage,
        inventory=partial(inventory, sessions, plan),
        page=partial(export_page, sessions, plan),
        ingest=partial(import_batch, database) if database is not None else None,
        source=source,
    )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path)
    return _mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    app, database = import_app(
        plan, state_root, "remote", (DesktopPreference, DesktopPreferenceImportReceipt), MIGRATIONS
    )
    return _mount(app, plan, database.sessions, database=database)
