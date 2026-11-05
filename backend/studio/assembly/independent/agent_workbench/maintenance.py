"""Assemble the Workbench owner's private maintenance routes."""

from functools import partial

from studio.apps.agent_workbench.storage.migration_receipts import AgentsImportReceipt
from studio.apps.agent_workbench.storage.migration_records import (
    DATASETS,
    conflict,
    ingest,
    inventory,
    read_page,
    search_inventory,
)
from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset

PREFIX = "/v1/migration/agents"
SEARCH = PREFIX + "/search/inventory"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount_records(app, plan, sessions, *, source=None):
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.suffix}",
            plan=plan,
            cursor_pattern=dataset.cursor_pattern,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset),
            page=partial(read_page, sessions, plan, dataset),
            ingest=partial(ingest, sessions, dataset, AgentsImportReceipt)
            if source is None
            else None,
            source=source,
        )

    @app.get(SEARCH)
    async def index_inventory():
        try:
            if source is not None:
                source.check()
            expected = await search_inventory(sessions, verify_index=source is None)
            if source is not None:
                source.check()
        except (ValueError, OSError):
            raise conflict("migration_source_changed") from None
        return expected

    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    return mount_records(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*(dataset.model for dataset in DATASETS), AgentsImportReceipt)
    app, database = import_app(plan, state_root, "agents", models, MIGRATIONS, **TRANSPORT)
    return mount_records(app, plan, database.sessions)
