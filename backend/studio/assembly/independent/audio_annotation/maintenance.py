"""Private Annotation history transfer and source project references."""

from functools import partial

from studio.apps.audio_annotation.storage.migration_records import (
    DATASETS,
    PINS,
    AnnotationImportReceipt,
    verify_project_coverage,
)
from studio.apps.audio_annotation.storage.migrations.registry import MIGRATIONS
from studio.contracts.audio_annotation.migration import PINS_PATH, PREFIX
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset
from studio.runtime.database.project_history_migration import (
    blocked,
    inventory,
    mount_project_history,
    read_page,
)

COVERAGE = PREFIX + "/project-coverage"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount_records(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, AnnotationImportReceipt, source=source
    )

    @app.get(COVERAGE)
    async def coverage():
        try:
            if source is not None:
                source.check()
            result = await verify_project_coverage(sessions)
            if source is not None:
                source.check()
        except (OSError, ValueError):
            raise blocked("migration_source_changed") from None
        return result

    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_dataset(
        app,
        prefix=PINS_PATH,
        plan=plan,
        cursor_pattern=PINS.cursor_pattern,
        batch_model=PINS.batch,
        page_model=PINS.page,
        inventory=partial(inventory, sessions, plan, PINS),
        page=partial(read_page, sessions, plan, PINS),
        source=source,
    )
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*(dataset.model for dataset in DATASETS), AnnotationImportReceipt)
    app, database = import_app(plan, state_root, "annotation", models, MIGRATIONS, **TRANSPORT)
    return mount_records(app, plan, database.sessions)
