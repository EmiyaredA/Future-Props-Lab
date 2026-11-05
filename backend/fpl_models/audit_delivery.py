"""Post-commit audit delivery replays immutable intent ids and keeps unknown outcomes."""

from sqlalchemy import select, update

from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.model_audit import ChildModelAudit, PreparedModelAudit

from .models import GovernanceAudit


class ModelAuditDelivery(PollingTaskRunner):
    runner_name = "models-audit-delivery"
    poll_interval_seconds = 1

    def __init__(self, sessions, client):
        super().__init__()
        self.sessions, self.client = sessions, client

    async def recover(self):
        pass

    async def process_once(self):
        async with self.sessions() as session:
            rows = list(
                await session.scalars(
                    select(GovernanceAudit)
                    .where(
                        GovernanceAudit.delivered_at.is_(None),
                        GovernanceAudit.source_fingerprint != "",
                    )
                    .order_by(GovernanceAudit.created_at, GovernanceAudit.id)
                    .limit(100)
                )
            )
            pending = [
                (
                    row.id,
                    row.source_fingerprint,
                    row.parent_intent_id,
                    row.created_at,
                    dict(row.detail),
                )
                for row in rows
            ]
        for identity, fingerprint, parent_id, created_at, detail in pending:
            if parent_id:
                await self.client.prepare_child(
                    ChildModelAudit(
                        id=identity,
                        parent_id=parent_id,
                        created_at=created_at,
                        status=detail["status_to"],
                    )
                )
            await self.client.commit(PreparedModelAudit(id=identity, fingerprint=fingerprint))
            async with self.sessions() as session:
                await session.execute(
                    update(GovernanceAudit)
                    .where(
                        GovernanceAudit.id == identity,
                        GovernanceAudit.source_fingerprint == fingerprint,
                        GovernanceAudit.delivered_at.is_(None),
                    )
                    .values(delivered_at=utc_now())
                )
                await session.commit()
