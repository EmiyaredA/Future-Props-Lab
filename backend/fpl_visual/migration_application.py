"""Loopback Visual history transfer, separate from the published application."""

from functools import partial

from fpl_runtime.migration_apps import export_app, import_app, mount_dataset
from fpl_runtime.project_history_migration import CURSOR, mount_project_history
from fpl_runtime.visual_migration import CANVAS_PINS_PATH, CanvasPinBatch, CanvasPinPage

from .migration_records import DATASETS
from .migration_references import export_canvas_pins, inventory_pins
from .migrations.registry import MIGRATIONS
from .models import VisualMigrationReceipt

PREFIX = "/v1/migration/visual"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, VisualMigrationReceipt, source=source
    )
    if source is not None:
        mount_dataset(
            app,
            prefix=CANVAS_PINS_PATH,
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=CanvasPinBatch,
            page_model=CanvasPinPage,
            inventory=partial(inventory_pins, sessions, plan),
            page=partial(export_canvas_pins, sessions, plan),
            source=source,
        )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    return mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*[dataset.model for dataset in DATASETS], VisualMigrationReceipt)
    app, database = import_app(plan, state_root, "visual", models, MIGRATIONS, **TRANSPORT)
    return mount(app, plan, database.sessions)
