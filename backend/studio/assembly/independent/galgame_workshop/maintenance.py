"""Loopback maintenance transport for Galgame projects and historical Stories."""

from functools import partial

from studio.apps.galgame_workshop.migration_references import export_pins, inventory_pins
from studio.apps.galgame_workshop.storage.migration_records import DATASETS, OPERATIONS
from studio.apps.galgame_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.galgame_workshop.storage.service_models import GalgameMigrationReceipt
from studio.contracts.galgame_workshop.galgame_migration import (
    PINS_PATH,
    StoryPinBatch,
    StoryPinPage,
)
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset
from studio.runtime.database.project_history_migration import CURSOR, mount_project_history
from studio.runtime.database.project_operations import ProjectOperationReceipt

PREFIX = "/v1/migration/galgame"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, GalgameMigrationReceipt, source=source
    )
    OPERATIONS.mount(app, plan, sessions, PREFIX, source=source)
    if source is not None:
        mount_dataset(
            app,
            prefix=PINS_PATH,
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=StoryPinBatch,
            page_model=StoryPinPage,
            inventory=partial(inventory_pins, sessions, plan),
            page=partial(export_pins, sessions, plan),
            source=source,
        )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    return mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (
        *[dataset.model for dataset in DATASETS],
        ProjectOperationReceipt,
        GalgameMigrationReceipt,
    )
    app, database = import_app(plan, state_root, "galgame", models, MIGRATIONS, **TRANSPORT)
    return mount(app, plan, database.sessions)
