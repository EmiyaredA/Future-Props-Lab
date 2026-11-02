from fastapi import HTTPException
from sqlalchemy import select

from .models import WorkbenchCheckpoint, WorkbenchEntry, WorkbenchSource
from .reading import get_conversation


async def attachment_reference(db, owner, session_id, attachment_id):
    await get_conversation(db, owner, session_id)
    attachments = (
        await db.scalars(
            select(WorkbenchEntry.attachments).where(
                WorkbenchEntry.session_id == session_id, WorkbenchEntry.attachments != []
            )
        )
    ).all()
    reference = next(
        (item for group in attachments for item in group if item.get("id") == attachment_id), None
    )
    if reference is None:
        raise HTTPException(404, "附件不存在")
    sources = (
        await db.scalars(
            select(WorkbenchSource)
            .join(WorkbenchCheckpoint, WorkbenchCheckpoint.source_id == WorkbenchSource.id)
            .where(
                WorkbenchCheckpoint.session_id == session_id,
                WorkbenchSource.owner_user_id == owner,
                WorkbenchSource.status != "unbound",
            )
        )
    ).all()
    roots = [source.root for source in sources if source.root]
    await db.rollback()
    return roots, reference["reference"]
