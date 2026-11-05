"""Deliver only durable Visual source outcomes to the Models job owner."""

from sqlalchemy import select, update

from studio.apps.visual_workshop.generation.generation_peer import GenerationPeer
from studio.apps.visual_workshop.generation_common import GenerationError
from studio.apps.visual_workshop.storage.generation_dispatch_records import VisualGenerationDecision
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.time import utc_now


class GenerationDecisions:
    def __init__(self, state):
        self.sessions = state.database.sessions
        self.peer = GenerationPeer(state)

    async def recover(self):
        row = VisualGenerationDecision
        async with self.sessions(info={"allow_system_reads": True}) as session:
            owners = list(
                await session.scalars(
                    select(row.owner_user_id).where(row.state == "preparing").distinct()
                )
            )
        for owner in owners:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(row)
                    .where(row.state == "preparing")
                    .values(state="abort", updated_at=utc_now())
                )
                await session.commit()

    async def deliver(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(VisualGenerationDecision, identity)
            if row is None or row.state not in {"activate", "abort"}:
                return
            state = row.state
        try:
            await self.peer.settle(row)
        except GenerationError as exc:
            raise CapabilityUnavailable("模型生成决议暂未确认") from exc
        async with self.sessions(info={"owner_user_id": owner}) as session:
            model = VisualGenerationDecision
            await session.execute(
                update(model)
                .where(model.id == identity, model.state == state)
                .values(state="active" if state == "activate" else "aborted", updated_at=utc_now())
            )
            await session.commit()

    async def process_once(self):
        row = VisualGenerationDecision
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(row.owner_user_id, row.id)
                    .where(row.state.in_(("activate", "abort")))
                    .order_by(row.updated_at, row.id)
                    .limit(50)
                )
            )
        first_error = None
        for owner, identity in pending:
            try:
                await self.deliver(owner, identity)
            except CapabilityUnavailable as exc:
                first_error = first_error or exc
        if first_error is not None:
            raise first_error
