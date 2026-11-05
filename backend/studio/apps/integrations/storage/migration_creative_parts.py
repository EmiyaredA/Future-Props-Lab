"""Verify the original and imported ownership of Creative component resources."""

from sqlalchemy import select

from studio.apps.integrations.storage.models import (
    McpIntegration,
    SkillIntegration,
    ToolApiIntegration,
)
from studio.contracts.creative_workshop.installation_migration import (
    DATASET,
    PAGE_SIZE,
    InstalledPart,
    InstalledParts,
    InstalledPartsPage,
)
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

from .creative_records import CreativeInstalledPart

MODELS = {"tool_api": ToolApiIntegration, "mcp": McpIntegration, "skill": SkillIntegration}


async def resource_present(session, owner, kind, resource_id):
    # Maintenance alone must distinguish an absent resource from a cross-account
    # reference. Read only the owner column and reject a mismatched owner.
    table = MODELS[kind].__table__
    assigned = await session.scalar(select(table.c.owner_user_id).where(table.c.id == resource_id))
    if assigned is not None and assigned != owner:
        raise blocked("migration_creative_installed_resource_owner_conflict")
    return assigned is not None


async def validate_resource(session, record):
    resource = record.result
    if resource.state == "pending_setup":
        return
    if record.resource_present is None:
        raise blocked("migration_creative_source_resource_unverified")
    actual = await resource_present(
        session, session.info["owner_user_id"], resource.kind, resource.resource_id
    )
    if actual != record.resource_present:
        raise blocked("migration_creative_installed_resource_presence_changed")


DATA = ProjectDataset(
    DATASET,
    CreativeInstalledPart,
    InstalledPart,
    InstalledParts,
    InstalledPartsPage,
    page_size=PAGE_SIZE,
)


def materialize(_owner, record):
    return record.model_dump(exclude={"resource_present"})
