"""Private maintenance routes for verified legacy Creative bindings."""

from dataclasses import replace
from functools import partial
from uuid import UUID

from studio.apps.integrations.storage.migration_creative_parts import (
    DATA,
    materialize,
    resource_present,
    validate_resource,
)
from studio.contracts.creative_workshop.installation_migration import (
    PREFIX,
    RESOURCE_PRESENCE,
    InstalledParts,
    InstalledPartsPage,
    LegacyResourcePresence,
    ResourceKind,
)
from studio.contracts.management.project_history import Identifier
from studio.runtime.database.migration_apps import mount_dataset
from studio.runtime.database.project_history_migration import (
    CURSOR,
    blocked,
    ingest,
    inventory,
    read_page,
)
from studio.runtime.http.migration_admission import MigrationAdmission


def mount_target(app, plan, sessions, receipt_model):
    ingest_dataset = replace(DATA, validate=validate_resource, materialize=materialize)

    async def page(owner, after):
        result = await read_page(sessions, plan, DATA, owner, after)
        records = []
        async with sessions(info={"owner_user_id": str(owner)}) as db:
            for record in result.batch.records:
                resource = record.result
                present = None
                if resource.state != "pending_setup":
                    present = await resource_present(
                        db, str(owner), resource.kind, resource.resource_id
                    )
                records.append(record.model_copy(update={"resource_present": present}))
        batch = result.batch.model_copy(update={"records": tuple(records)})
        return result.model_copy(update={"batch": batch, "sha256": batch.digest})

    mount_dataset(
        app,
        prefix=PREFIX,
        plan=plan,
        cursor_pattern=CURSOR,
        batch_model=InstalledParts,
        page_model=InstalledPartsPage,
        inventory=partial(inventory, sessions, plan, DATA),
        page=page,
        ingest=partial(ingest, sessions, ingest_dataset, receipt_model),
    )


def mount_source_presence(app, plan, sessions, source):
    admission = MigrationAdmission(plan)

    @app.get(
        RESOURCE_PRESENCE + "/{owner}/{kind}/{resource_id}", response_model=LegacyResourcePresence
    )
    async def presence(owner: UUID, kind: ResourceKind, resource_id: Identifier):
        admission.check_owner(owner)
        try:
            source.check()
            async with sessions() as db:
                present = await resource_present(db, str(owner), kind, resource_id)
            source.check()
        except (OSError, ValueError):
            raise blocked("migration_source_changed") from None
        return LegacyResourcePresence(
            run_id=plan.run_id,
            source_database_sha256=plan.source_database_sha256,
            owner_id=owner,
            resource_id=resource_id,
            kind=kind,
            present=present,
        )
