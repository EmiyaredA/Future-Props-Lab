from sqlalchemy import update

from studio.apps.visual_workshop.acceptance.models import AcceptanceStandard
from studio.runtime.revisions import RevisionConflictError


async def cas(session, row, expected, current):
    # Take the SQLite writer lock before re-reading the revision; a stale client must
    # never overwrite either a worker result or another reviewer's decision.
    cls = type(row)
    key = cls.project_id == row.project_id if cls is AcceptanceStandard else cls.id == row.id
    result = await session.execute(
        update(cls)
        .where(key, cls.revision == expected)
        .values(revision=expected + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await session.rollback()
        snapshot = await current()
        raise RevisionConflictError(expected, snapshot.revision, snapshot.model_dump(mode="json"))
    await session.refresh(row)
