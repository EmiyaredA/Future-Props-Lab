"""Native requests are bound to an assigned lease and the current source grant."""

import secrets
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from app.apps.agent_workbench.models import WorkbenchCheckpoint, WorkbenchSource
from app.runtime.config import get_settings
from app.runtime.ownership import bind_owner

from .models import NativeJob, NativeSubscription, NativeWorkerSeen


@dataclass(frozen=True)
class Worker:
    id: str
    operations: frozenset[str]


class NativeTransport:
    def __init__(self, app, *, ingress_token, workers, operations):
        if len(ingress_token) < 32 or any(len(token) < 32 for token in workers.values()):
            raise ValueError("原生采集通道凭据强度不足")
        self.app, self.ingress, self.workers = app, ingress_token, dict(workers)
        self.operations = frozenset(operations)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        proof = headers.get("x-fpl-native-ingress", "")
        bearer = headers.get("authorization", "").removeprefix("Bearer ")
        worker = next(
            (
                Worker(name, self.operations)
                for name, token in self.workers.items()
                if secrets.compare_digest(token, bearer)
            ),
            None,
        )
        if not secrets.compare_digest(proof, self.ingress) or worker is None:
            await JSONResponse(
                {"code": "native_worker_required"}, 403, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)
            return
        scope = {**scope, "state": {**scope.get("state", {}), "native_worker": worker}}
        await self.app(scope, receive, send)


async def see_worker(database, worker, now):
    async with database.sessions() as session:
        await session.execute(
            insert(NativeWorkerSeen)
            .values(id=worker.id, last_seen_at=now)
            .on_conflict_do_update(index_elements=[NativeWorkerSeen.id], set_={"last_seen_at": now})
        )
        await session.commit()


async def verify_follow(database, identity, worker, lease):
    if not get_settings().fpl_agent_workbench_enabled:
        raise HTTPException(410, "native_collection_disabled")
    if lease.operation != "agent_sources.follow" or lease.operation not in worker.operations:
        raise HTTPException(403, "native_operation_forbidden")
    async with database.sessions() as session:
        bind_owner(session, lease.owner_user_id)
        job = await session.get(NativeJob, str(lease.job_id))
        if (
            job is None
            or job.worker_id != worker.id
            or job.lease_id != str(lease.lease_id)
            or job.operation != lease.operation
            or job.status not in {"leased", "unknown"}
            or job.outcome_sha256 is not None
        ):
            raise HTTPException(410, "native_lease_ended")
        source_id = job.payload["source_id"]
        source = await session.get(WorkbenchSource, source_id)
        subscription = await session.get(NativeSubscription, source_id)
        if (
            source is None
            or not source.enabled
            or source.status == "unbound"
            or source.revision != job.payload["source_revision"]
            or subscription is None
            or subscription.current_job_id != job.id
        ):
            raise HTTPException(410, "native_source_grant_changed")
        context = {
            "id": source.id,
            "owner": source.owner_user_id,
            "revision": source.revision,
            "agent_id": source.agent_id,
            "root": source.root,
            "endpoint": source.endpoint,
            "authorization_revision": subscription.authorization_revision,
        }
    permission = await identity.owner_permission(owner=context["owner"], permission="content.read")
    if permission.get("available") is False:
        raise HTTPException(503, "native_identity_unavailable")
    if permission.get("allowed") is not True:
        raise HTTPException(403, "native_account_not_authorized")
    if permission.get("revision") != context["authorization_revision"]:
        raise HTTPException(410, "native_account_grant_changed")
    return context


async def checkpoint_snapshot(database, context):
    async with database.sessions() as session:
        bind_owner(session, context["owner"])
        rows = await session.scalars(
            select(WorkbenchCheckpoint).where(WorkbenchCheckpoint.source_id == context["id"])
        )
        return {
            **context,
            "checkpoints": {row.locator: row.state for row in rows},
        }
