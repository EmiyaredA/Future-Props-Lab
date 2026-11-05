"""Release verified scratch leases after their bounded review recovery interval."""

from datetime import datetime

from anyio.to_thread import run_sync
from sqlalchemy import select

from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now

from .models import VisualReviewJob
from .review_artifacts import RECOVERY_GRACE


class ReviewArtifactSweep(PollingTaskRunner):
    runner_name = "agent-runtime-review-artifacts"
    poll_interval_seconds = 300

    def __init__(self, database, artifacts, *, clock=utc_now):
        super().__init__()
        self.database, self.artifacts, self.clock = database, artifacts, clock

    async def recover(self):
        return

    async def process_once(self):
        cutoff = self.clock() - RECOVERY_GRACE
        for job_id, lease_id in await run_sync(self.artifacts.stored_leases):
            if await self.expired(job_id, lease_id, cutoff):
                await self.artifacts.remove_expired(job_id, lease_id)

    async def expired(self, job_id, lease_id, cutoff):
        model = VisualReviewJob
        async with self.database.sessions(info={"allow_system_reads": True}) as db:
            deadline = await db.scalar(
                select(model.payload["plan"]["deadline"].as_string()).where(
                    model.id == job_id, model.lease_id == lease_id
                )
            )
        return deadline is not None and datetime.fromisoformat(deadline) < cutoff
