"""Loopback Visual history transfer, separate from the published application."""

from functools import partial

from studio.apps.visual_workshop.migration_acceptance_pins import (
    export_acceptance_pins,
    inventory_acceptance_pins,
)
from studio.apps.visual_workshop.migration_references import (
    export_canvas_pins,
    export_conversation_pins,
    inventory_conversation_pins,
    inventory_pins,
)
from studio.apps.visual_workshop.storage.migration_records import DATASETS, OPERATIONS
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.visual_workshop.storage.service_models import VisualMigrationReceipt
from studio.contracts.visual_workshop.visual_migration import (
    ACCEPTANCE_PINS_PATH,
    CANVAS_PINS_PATH,
    CONVERSATION_PINS_PATH,
    AcceptancePinBatch,
    AcceptancePinPage,
    CanvasPinBatch,
    CanvasPinPage,
    ConversationPinBatch,
    ConversationPinPage,
)
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset
from studio.runtime.database.project_history_migration import CURSOR, mount_project_history
from studio.runtime.database.project_operations import ProjectOperationReceipt

PREFIX = "/v1/migration/visual"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, DATASETS, VisualMigrationReceipt, source=source
    )
    OPERATIONS.mount(app, plan, sessions, PREFIX, source=source)
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
        mount_dataset(
            app,
            prefix=CONVERSATION_PINS_PATH,
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=ConversationPinBatch,
            page_model=ConversationPinPage,
            inventory=partial(inventory_conversation_pins, sessions, plan),
            page=partial(export_conversation_pins, sessions, plan),
            source=source,
        )
        mount_dataset(
            app,
            prefix=ACCEPTANCE_PINS_PATH,
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=AcceptancePinBatch,
            page_model=AcceptancePinPage,
            inventory=partial(inventory_acceptance_pins, sessions, plan),
            page=partial(export_acceptance_pins, sessions, plan),
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
        VisualMigrationReceipt,
    )
    app, database = import_app(plan, state_root, "visual", models, MIGRATIONS, **TRANSPORT)
    return mount(app, plan, database.sessions)
