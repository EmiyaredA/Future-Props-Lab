"""Bind the Tools navigation dataset to explicit maintenance applications."""

from functools import partial

from studio.apps.tools.navigation_migration import (
    TOOL_ID,
    NavigationBatch,
    NavigationPage,
    export_page,
    import_batch,
    navigation_inventory,
)
from studio.apps.tools.storage.migrations.registry import MIGRATIONS
from studio.apps.tools.storage.navigation_models import ToolNavigationItem
from studio.apps.tools.storage.service_models import ToolsNavigationImportReceipt
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset

PREFIX = "/v1/migration/tools/navigation"


def _mount(app, plan, sessions, *, source=None, database=None):
    mount_dataset(
        app,
        prefix=PREFIX,
        plan=plan,
        cursor_pattern=TOOL_ID,
        batch_model=NavigationBatch,
        page_model=NavigationPage,
        inventory=partial(
            navigation_inventory, sessions, plan.owner_ids, system=database is not None
        ),
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
        plan, state_root, "tools", (ToolNavigationItem, ToolsNavigationImportReceipt), MIGRATIONS
    )
    return _mount(app, plan, database.sessions, database=database)
