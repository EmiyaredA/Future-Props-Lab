"""Node output history and reference resolution owned by the visual workshop."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.outputs.history import register_output


async def register_imported_output(
    session: AsyncSession,
    project_id: str,
    node: dict,
    *,
    asset_id: str,
    source_key: str,
) -> None:
    """Register imported media in the caller's canvas transaction.

    The caller validates the project/asset Workspace and media kind, holds the
    canvas CAS write lock, and persists the updated node in the same transaction.
    A stable source key makes duplicate registration a no-op.
    """
    await register_output(
        session,
        project_id,
        node,
        source="uploaded",
        source_key=source_key,
        asset_id=asset_id,
    )
