"""Loopback-only historical Motion record transfer against sealed state."""

from fpl_runtime.migration_apps import export_app, import_app
from fpl_runtime.project_history_migration import mount_project_history

from .migration_artifacts import mount_motion_artifacts
from .migration_records import DATASETS
from .migrations.registry import MIGRATIONS
from .models import MotionExportBinding, MotionMigrationReceipt

PREFIX = "/v1/migration/motion"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, MotionMigrationReceipt, source=source
    )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_motion_artifacts(app, plan, sessions, source)
    return mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*[dataset.model for dataset in DATASETS], MotionMigrationReceipt, MotionExportBinding)
    app, database = import_app(plan, state_root, "motion", models, MIGRATIONS, **TRANSPORT)
    return mount(app, plan, database.sessions)
