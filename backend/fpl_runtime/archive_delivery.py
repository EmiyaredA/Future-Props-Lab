"""Deliver durable archive outcomes after source commit and restart."""

from uuid import uuid4

from sqlalchemy import select, text, update

from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now

from .thought_archives import ArchiveBatchKey, ArchiveOutcome


async def reserve_import(session, records, owner, digest):
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    row = await session.scalar(
        select(records).where(
            records.owner_user_id == owner,
            records.source_sha256 == digest,
            records.state.in_(("staging", "commit")),
        )
    )
    if row is not None:
        previous = row.batch_id, row.state
        await session.rollback()
        return previous
    batch_id = uuid4().hex
    session.add(records(owner_user_id=owner, batch_id=batch_id, source_sha256=digest))
    await session.commit()
    return batch_id, None


class FileBatchDelivery(PollingTaskRunner):
    poll_interval_seconds = 1
    retry_interrupted = True

    def __init__(self, sessions, transport):
        super().__init__()
        self.sessions, self.transport = sessions, transport

    async def recover(self):
        # Lifespan holds the service lock. No writer from the prior process can commit.
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(self.records.owner_user_id, self.records.batch_id).where(
                        self.records.state == "staging"
                    )
                )
            )
        for owner, batch_id in pending:
            await self.release(owner, batch_id, retry=self.retry_interrupted)

    async def release(self, owner, batch_id, *, retry):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(self.records)
                .where(
                    self.records.batch_id == batch_id,
                    self.records.state == "staging",
                )
                .values(state="retry" if retry else "abort", updated_at=utc_now())
            )
            await session.commit()

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(self.records.owner_user_id, self.records.batch_id)
                    .where(self.records.state.in_(("commit", "abort")))
                    .order_by(self.records.updated_at)
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
                        update(self.records)
                        .where(
                            self.records.batch_id == batch_id,
                            self.records.state.in_(("commit", "abort")),
                        )
                        .values(updated_at=utc_now())
                    )
                    await session.commit()
        if first_failure:
            raise first_failure

    async def deliver(self, owner, batch_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(self.records, (owner, batch_id))
            if row is None or row.state in {"staging", "retry"}:
                raise self.pending_error()
            state, result = row.state, row.result
            if state == "published":
                return self.result_model.model_validate(result)
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
        await self.cleanup(batch_id)
        await self.complete(owner, batch_id, state, result)
        return self.result_model.model_validate(result) if state == "commit" else None

    async def complete(self, owner, batch_id, state, _result):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(self.records)
                .where(self.records.batch_id == batch_id, self.records.state == state)
                .values(
                    state="published" if state == "commit" else "discarded", updated_at=utc_now()
                )
            )
            await session.commit()

    async def cleanup(self, _batch_id):
        return
