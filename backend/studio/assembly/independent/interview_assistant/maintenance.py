"""Start Interview's private metadata and original-material maintenance listener."""

from studio.apps.interview_assistant.storage.migration_materials import PREFIX as MATERIALS
from studio.apps.interview_assistant.storage.migration_records import (
    DATASETS,
    InterviewImportReceipt,
    verify_room_links,
)
from studio.apps.interview_assistant.storage.migrations.registry import MIGRATIONS
from studio.apps.interview_assistant.transport.migration_materials_http import mount_materials
from studio.runtime.database.migration_apps import export_app, import_app
from studio.runtime.database.project_history_migration import blocked, mount_project_history

PREFIX = "/v1/migration/interview"
RELATIONSHIPS = PREFIX + "/relationships"
TRANSPORT = {"maximum": 32 * 1024 * 1024, "streaming_prefix": MATERIALS + "/"}


def mount_records(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, InterviewImportReceipt, source=source
    )

    @app.get(RELATIONSHIPS)
    async def relationships():
        try:
            if source is not None:
                source.check()
            report = await verify_room_links(sessions)
            if source is not None:
                source.check()
        except (OSError, ValueError):
            raise blocked("migration_source_changed") from None
        return report

    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_materials(app, plan, sessions, root=source.path.parent, source=source)
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*(dataset.model for dataset in DATASETS), InterviewImportReceipt)
    app, database = import_app(plan, state_root, "interview", models, MIGRATIONS, **TRANSPORT)
    mount_materials(app, plan, database.sessions, root=database.root)
    return mount_records(app, plan, database.sessions)
