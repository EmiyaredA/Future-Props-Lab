"""Read Story snapshot metadata after the caller verifies the project owner."""

from sqlalchemy import select

from app.apps.galgame_workshop.models import GalgameStorySnapshot
from app.apps.galgame_workshop.schemas import GalgameStorySnapshotOut
from app.runtime.time import iso_utc


async def list_snapshots(session, project_id):
    rows = list(
        (
            await session.execute(
                select(GalgameStorySnapshot)
                .where(GalgameStorySnapshot.project_id == project_id)
                .order_by(GalgameStorySnapshot.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        GalgameStorySnapshotOut(
            id=row.id,
            storyRevision=row.story_revision,
            reason=row.reason,
            createdAt=iso_utc(row.created_at),
        )
        for row in rows
    ]
