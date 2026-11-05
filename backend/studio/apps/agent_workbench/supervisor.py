"""One checkpointed native follow task per source grant; unknown actions are not requeued."""

from datetime import timedelta

from sqlalchemy import select, text

from studio.apps.agent_workbench.storage.models import (
    WorkbenchChange,
    WorkbenchOperation,
    WorkbenchSource,
)
from studio.apps.agent_workbench.storage.service_models import (
    NativeJob,
    NativeSubscription,
    NativeWorkerSeen,
)
from studio.contracts.identity.permissions import CLOUD_CONTROL_PERMISSION
from studio.runtime.database.ownership import bind_owner
from studio.runtime.ids import new_id
from studio.runtime.tasks.native_queue import digest
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class CollectionSupervisor(PollingTaskRunner):
    runner_name = "native-agent-collection"
    poll_interval_seconds = 2

    def __init__(self, database, identity):
        super().__init__()
        self.database, self.identity = database, identity

    async def recover(self):
        # Leases, projection receipts and source checkpoints survive process restarts.
        return

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            sources = list(
                await session.scalars(
                    select(WorkbenchSource).where(
                        WorkbenchSource.enabled.is_(True), WorkbenchSource.status != "unbound"
                    )
                )
            )
        async with self.database.sessions() as session:
            seen = await session.scalar(
                select(NativeWorkerSeen.last_seen_at)
                .order_by(NativeWorkerSeen.last_seen_at.desc())
                .limit(1)
            )
        online = seen is not None and seen > utc_now() - timedelta(seconds=45)
        for source in sources:
            permission = await self.identity.owner_permission(
                owner=source.owner_user_id, permission=CLOUD_CONTROL_PERMISSION
            )
            if permission.get("allowed") is True:
                await self.ensure(source, permission["revision"])
                if not online:
                    await self.offline(source)

    async def offline(self, source):
        async with self.database.sessions() as session:
            bind_owner(session, source.owner_user_id)
            current = await session.get(WorkbenchSource, source.id)
            if not current or not current.enabled or current.revision != source.revision:
                return
            message = "Mac 原生采集器离线；已保留同步副本，恢复连接后继续"
            if current.status != "unavailable" or current.message != message:
                current.status, current.message = "unavailable", message
                session.add(WorkbenchChange(owner_user_id=source.owner_user_id, kind="source"))
                await session.commit()

    async def ensure(self, source, authorization_revision):
        async with self.database.sessions() as session:
            bind_owner(session, source.owner_user_id)
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(WorkbenchSource, source.id)
            if not current or not current.enabled or current.revision != source.revision:
                await session.rollback()
                return
            epoch = (
                await session.scalar(
                    select(WorkbenchOperation.id)
                    .where(WorkbenchOperation.source_id == source.id)
                    .order_by(WorkbenchOperation.created_at.desc(), WorkbenchOperation.id.desc())
                    .limit(1)
                )
                or "initial"
            )
            subscription = await session.get(NativeSubscription, source.id)
            attempt = 0
            if (
                subscription
                and subscription.source_revision == source.revision
                and subscription.authorization_revision == authorization_revision
                and subscription.scan_epoch == epoch
            ):
                job = await session.get(NativeJob, subscription.current_job_id)
                if job and job.status in {"queued", "leased", "unknown"}:
                    await session.rollback()
                    return
                if job and job.updated_at > utc_now() - timedelta(seconds=30):
                    await session.rollback()
                    return
                attempt = subscription.attempt + 1
            payload = {"source_id": source.id, "source_revision": source.revision}
            request_id = (
                f"follow:{source.id}:{source.revision}:{authorization_revision}:{epoch}:{attempt}"
            )
            job = NativeJob(
                id=new_id(),
                owner_user_id=source.owner_user_id,
                operation="agent_sources.follow",
                request_id=request_id,
                payload=payload,
                payload_sha256=digest({"operation": "agent_sources.follow", "payload": payload}),
            )
            session.add(job)
            await session.flush()
            if subscription is None:
                subscription = NativeSubscription(
                    source_id=source.id,
                    owner_user_id=source.owner_user_id,
                )
                session.add(subscription)
            subscription.current_job_id = job.id
            subscription.source_revision = source.revision
            subscription.authorization_revision = authorization_revision
            subscription.scan_epoch = epoch
            subscription.attempt = attempt
            await session.commit()
