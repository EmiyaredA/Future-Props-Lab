"""Private maintenance application for Thought-owned documents and references."""

from functools import partial

from studio.apps.thought_workshop.storage.migration_documents import (
    DATASETS,
    conflict,
    ingest,
    inventory,
    page,
)
from studio.apps.thought_workshop.storage.migration_pins import mount_legacy_pins
from studio.apps.thought_workshop.storage.migration_receipts import ThoughtImportReceipt
from studio.apps.thought_workshop.storage.migration_relationships import relationship_inventory
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.service_models import MODELS
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset

PREFIX = "/v1/migration/thought"
RELATIONSHIPS = PREFIX + "/document-relationships/inventory"
TRANSPORT = {"maximum": 32 * 1024 * 1024}


def mount_documents(app, plan, sessions, source=None):
    allowed_owners = frozenset(str(owner) for owner in plan.owner_ids)
    for dataset in DATASETS:
        mount_dataset(
            app,
            prefix=f"{PREFIX}/{dataset.suffix}",
            plan=plan,
            cursor_pattern=dataset.cursor_pattern,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset),
            page=partial(page, sessions, plan, dataset),
            ingest=partial(
                ingest,
                sessions,
                dataset,
                receipt_model=ThoughtImportReceipt,
                allowed_owners=allowed_owners,
            )
            if source is None
            else None,
            source=source,
        )

    @app.get(RELATIONSHIPS)
    async def verify_document_relationships():
        try:
            if source is not None:
                source.check()
            result = await relationship_inventory(sessions)
            if source is not None:
                source.check()
        except (OSError, ValueError):
            raise conflict("migration_source_changed") from None
        return result


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_documents(app, plan, sessions, source)
    mount_legacy_pins(app, plan, sessions, source)
    return app


def create_import_app(*, plan, state_root):
    app, database = import_app(
        plan, state_root, "thought", (*MODELS, ThoughtImportReceipt), MIGRATIONS, **TRANSPORT
    )
    mount_documents(app, plan, database.sessions)
    return app
