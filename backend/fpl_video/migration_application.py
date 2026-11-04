"""Loopback-only historical Video record transfer against sealed state."""

from fpl_runtime.migration_apps import export_app, import_app
from fpl_runtime.project_history_migration import mount_project_history

from .migration_records import DATASETS
from .migrations.registry import MIGRATIONS
from .models import VideoMigrationReceipt

PREFIX = "/v1/migration/video"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, VideoMigrationReceipt, source=source
    )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    return mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*[dataset.model for dataset in DATASETS], VideoMigrationReceipt)
    app, database = import_app(plan, state_root, "video", models, MIGRATIONS, **TRANSPORT)
    return mount(app, plan, database.sessions)
