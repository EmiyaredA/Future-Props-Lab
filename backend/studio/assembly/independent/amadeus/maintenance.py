"""Private Amadeus history transfer with graph verification before startup."""

from studio.apps.amadeus.storage.migration_history import (
    DATASETS,
    AmadeusImportReceipt,
    mount_links,
    verify_history,
)
from studio.apps.amadeus.storage.migration_originals import PREFIX as ORIGINALS
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.transport.migration_originals_http import mount_originals
from studio.runtime.database.migration_apps import export_app, import_app
from studio.runtime.database.project_history_migration import blocked, mount_project_history

PREFIX = "/v1/migration/amadeus"
RELATIONSHIPS = PREFIX + "/relationships"
TRANSPORT = {"maximum": 32 * 1024 * 1024, "streaming_prefix": ORIGINALS + "/"}


def mount_records(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, AmadeusImportReceipt, source=source
    )
    mount_links(app, plan, sessions, PREFIX, source)

    @app.get(RELATIONSHIPS)
    async def relationships():
        try:
            if source is not None:
                source.check()
            report = await verify_history(sessions)
            if source is not None:
                source.check()
        except (OSError, ValueError):
            raise blocked("migration_source_changed") from None
        return report

    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_originals(app, plan, sessions, root=source.path.parent, source=source)
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*(dataset.model for dataset in DATASETS), AmadeusImportReceipt)
    app, database = import_app(plan, state_root, "amadeus", models, MIGRATIONS, **TRANSPORT)
    mount_originals(app, plan, database.sessions, root=database.root)
    return mount_records(app, plan, database.sessions)
