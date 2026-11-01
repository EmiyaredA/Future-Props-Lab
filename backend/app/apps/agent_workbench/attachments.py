import asyncio

from fastapi import HTTPException
from sqlalchemy import select

from app.capabilities.agents.sessions.attachments import read_reference

from .models import WorkbenchCheckpoint, WorkbenchEntry, WorkbenchSource
from .reading import get_conversation


async def attachment(db, owner, session_id, attachment_id):
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
    for root in roots:
        try:
            return await asyncio.to_thread(read_reference, root, reference["reference"])
        except (OSError, ValueError):
            continue
    raise HTTPException(404, "原生附件不在已授权来源范围内或已不可用")
