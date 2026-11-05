"""Recover only archive decisions that Thought has durably established."""

import re
import shutil
from uuid import uuid4

from anyio.to_thread import run_sync
from sqlalchemy import select, text

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from fpl_runtime.archive_delivery import FileBatchDelivery as FileBatchDelivery

from .archive_records import ThoughtArchiveImport


async def begin_import(session, owner, fingerprint, request_key):
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    query = select(ThoughtArchiveImport).where(ThoughtArchiveImport.owner_user_id == owner)
    if request_key is not None:
        query = query.where(ThoughtArchiveImport.request_key == request_key)
    else:
        query = query.where(
            ThoughtArchiveImport.request_key.is_(None),
            ThoughtArchiveImport.source_sha256 == fingerprint,
            ThoughtArchiveImport.state.in_(("staging", "retry", "commit")),
        )
    row = await session.scalar(query.limit(1))
    if row is not None:
        if row.source_sha256 != fingerprint:
            raise ThoughtError("导入请求标识已用于其他归档", 409, "archive_request_conflict")
        if row.state == "retry":
            row.state = "staging"
            batch_id = row.batch_id
            await session.commit()
            return batch_id, None
        previous = row.batch_id, row.state
        await session.rollback()
        return previous
    batch_id = uuid4().hex
    session.add(
        ThoughtArchiveImport(
            owner_user_id=owner,
            batch_id=batch_id,
            request_key=request_key,
            source_sha256=fingerprint,
        )
    )
    await session.commit()
    return batch_id, None


class ArchiveDelivery(FileBatchDelivery):
    runner_name = "thought-archive-delivery"
    records = ThoughtArchiveImport
    result_model = ThoughtImportOut
    pending_error = staticmethod(lambda: ThoughtError("归档批次尚未提交", 409, "archive_pending"))

    def __init__(self, sessions, transport, root):
        super().__init__(sessions, transport)
        self.root = root

    def scratch_path(self, batch_id):
        if not re.fullmatch(r"[a-f0-9]{32}", batch_id):
            raise ValueError("归档批次标识无效")
        path = self.root / batch_id
        if self.root.is_symlink() or path.is_symlink():
            raise ValueError("归档暂存目录不允许符号链接")
        return path

    async def cleanup(self, batch_id):
        try:
            # The target has confirmed this exact batch is terminal. Pending directories remain.
            await run_sync(shutil.rmtree, self.scratch_path(batch_id))
        except FileNotFoundError:
            pass
