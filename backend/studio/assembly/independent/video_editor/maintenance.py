"""Loopback-only historical Video record transfer against sealed state."""

from studio.apps.video_editor.migration_artifacts import mount_video_artifacts
from studio.apps.video_editor.storage.migration_records import DATASETS
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS
from studio.apps.video_editor.storage.service_models import (
    VideoMediaDispatch,
    VideoMigrationReceipt,
)
from studio.runtime.database.migration_apps import export_app, import_app
from studio.runtime.database.project_history_migration import mount_project_history

PREFIX = "/v1/migration/video"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, VideoMigrationReceipt, source=source
    )
    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_video_artifacts(app, plan, sessions, source)
    return mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*[dataset.model for dataset in DATASETS], VideoMigrationReceipt, VideoMediaDispatch)
    app, database = import_app(plan, state_root, "video", models, MIGRATIONS, **TRANSPORT)
    return mount(app, plan, database.sessions)
