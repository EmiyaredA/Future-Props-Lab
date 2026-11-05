"""Project verified stdio setup onto owned installations without changing install receipts."""

from sqlalchemy import select, text

from studio.apps.creative_workshop.storage.models import CreativeInstallation
from studio.contracts.creative_workshop.catalog import CreativeInstallOut


class StdioRecordError(ValueError):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def merge_resource(previous, incoming):
    if previous == incoming:
        return previous
    if (
        previous.get("kind") == incoming.get("kind") == "mcp"
        and previous.get("release_id") == incoming.get("release_id")
        and previous.get("name") == incoming.get("name")
    ):
        if previous.get("state") == "pending_setup" and incoming.get("state") == "disabled":
            return incoming
        if previous.get("state") == "disabled" and incoming.get("state") == "pending_setup":
            return previous
    raise StdioRecordError(409, "creative_install_resource_conflict")


async def installation_part(session, installation_id, release_id):
    installation = await session.get(CreativeInstallation, installation_id)
    if installation is None:
        raise StdioRecordError(404, "not_found")
    part = next(
        (
            entry
            for entry in installation.resources
            if entry.get("kind") == "mcp" and entry.get("release_id") == release_id
        ),
        None,
    )
    if part is None or part.get("state") not in {"pending_setup", "disabled"}:
        raise StdioRecordError(409, "not_pending")
    return installation, part


async def record_setup(database, owner, installation_id, release_id, resource):
    if (
        not isinstance(resource, dict)
        or set(resource) != {"release_id", "kind", "name", "resource_id", "state"}
        or resource["release_id"] != release_id
        or resource["kind"] != "mcp"
        or resource["state"] != "disabled"
        or not isinstance(resource["resource_id"], str)
        or not resource["resource_id"]
    ):
        raise ValueError("invalid stdio receipt")
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        root, part = await installation_part(session, installation_id, release_id)
        merge_resource(part, resource)
        rows = await session.scalars(
            select(CreativeInstallation).where(CreativeInstallation.owner_user_id == owner)
        )
        for row in rows:
            row.resources = [
                merge_resource(entry, resource) if entry.get("release_id") == release_id else entry
                for entry in row.resources
            ]
        result = CreativeInstallOut(
            id=root.id, release_id=root.release_id, resources=root.resources
        )
        await session.commit()
        return result
