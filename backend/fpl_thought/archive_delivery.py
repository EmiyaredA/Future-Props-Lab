"""Recover only archive decisions that Thought has durably established."""

import re
import shutil
from uuid import uuid4

from anyio.to_thread import run_sync
from sqlalchemy import select, text, update

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.thought_archives import ArchiveBatchKey, ArchiveOutcome

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


class ArchiveDelivery(PollingTaskRunner):
    runner_name = "thought-archive-delivery"
    poll_interval_seconds = 1

    def __init__(self, sessions, transport, root):
        super().__init__()
        self.sessions, self.transport, self.root = sessions, transport, root

    def scratch_path(self, batch_id):
        if not re.fullmatch(r"[a-f0-9]{32}", batch_id):
            raise ValueError("归档批次标识无效")
        path = self.root / batch_id
        if self.root.is_symlink() or path.is_symlink():
            raise ValueError("归档暂存目录不允许符号链接")
        return path

    async def recover(self):
        # Lifespan holds the service lock. No writer from the prior process can commit.
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(ThoughtArchiveImport.owner_user_id, ThoughtArchiveImport.batch_id).where(
                        ThoughtArchiveImport.state == "staging"
                    )
                )
            )
        for owner, batch_id in pending:
            await self.release(owner, batch_id, retry=True)

    async def release(self, owner, batch_id, *, retry):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(ThoughtArchiveImport)
                .where(
                    ThoughtArchiveImport.batch_id == batch_id,
                    ThoughtArchiveImport.state == "staging",
                )
                .values(state="retry" if retry else "abort", updated_at=utc_now())
            )
            await session.commit()

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(ThoughtArchiveImport.owner_user_id, ThoughtArchiveImport.batch_id)
                    .where(ThoughtArchiveImport.state.in_(("commit", "abort")))
                    .order_by(ThoughtArchiveImport.updated_at)
                    .limit(50)
                )
            )
        first_failure = None
        for owner, batch_id in pending:
            try:
                await self.deliver(owner, batch_id)
            except Exception as exc:
                # Keep unrelated batches moving if one decision needs operator attention.
                first_failure = first_failure or exc
                async with self.sessions(info={"owner_user_id": owner}) as session:
                    await session.execute(
                        update(ThoughtArchiveImport)
                        .where(
                            ThoughtArchiveImport.batch_id == batch_id,
                            ThoughtArchiveImport.state.in_(("commit", "abort")),
                        )
                        .values(updated_at=utc_now())
                    )
                    await session.commit()
        if first_failure:
            raise first_failure

    async def deliver(self, owner, batch_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(ThoughtArchiveImport, (owner, batch_id))
            if row is None or row.state in {"staging", "retry"}:
                raise ThoughtError("归档批次尚未提交", 409, "archive_pending")
            state, result = row.state, row.result
            if state == "published":
                return ThoughtImportOut.model_validate(result)
            if state == "discarded":
                return None
            key = ArchiveBatchKey(batch_id=batch_id, source_sha256=row.source_sha256)
            outcome = ArchiveOutcome(
                **key.model_dump(),
                owner=owner,
                decision=state,
                manifest_sha256=row.manifest_sha256 if state == "commit" else None,
            )
        await self.transport.settle(outcome)
        try:
            # The target has confirmed this exact batch is terminal. Pending directories remain.
            await run_sync(shutil.rmtree, self.scratch_path(batch_id))
        except FileNotFoundError:
            pass
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(ThoughtArchiveImport)
                .where(
                    ThoughtArchiveImport.batch_id == batch_id, ThoughtArchiveImport.state == state
                )
                .values(
                    state="published" if state == "commit" else "discarded", updated_at=utc_now()
                )
            )
            await session.commit()
        return ThoughtImportOut.model_validate(result) if state == "commit" else None
