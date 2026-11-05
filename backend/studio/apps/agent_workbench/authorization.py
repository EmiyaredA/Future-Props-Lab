"""Native requests are bound to an assigned lease and the current source grant."""

import secrets
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from studio.apps.agent_workbench.storage.models import WorkbenchCheckpoint, WorkbenchSource
from studio.apps.agent_workbench.storage.service_models import (
    NativeJob,
    NativeSubscription,
    NativeWorkerSeen,
)
from studio.config.settings import get_settings
from studio.contracts.agent_workbench.execution import DISCOVERY_OPERATIONS
from studio.contracts.identity.permissions import CLOUD_CONTROL_PERMISSION
from studio.runtime.database.ownership import bind_owner


@dataclass(frozen=True)
class Worker:
    id: str
    operations: frozenset[str]


class NativeTransport:
    def __init__(self, app, *, ingress_token, workers, operations, execution_workers=None):
        if len(ingress_token) < 32 or any(len(token) < 32 for token in workers.values()):
            raise ValueError("原生采集通道凭据强度不足")
        self.app, self.ingress, self.workers = app, ingress_token, dict(workers)
        self.operations = frozenset(operations)
        self.execution_workers = dict(execution_workers or {})
        native_tokens = {ingress_token, *workers.values()}
        if any(
            not isinstance(token, str) or len(token) < 32 or token in native_tokens
            for token in self.execution_workers.values()
        ) or len(set(self.execution_workers.values())) != len(self.execution_workers):
            raise ValueError("工作台执行与采集需要独立凭据")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        proof = headers.get("x-fpl-native-ingress", "")
        bearer = headers.get("authorization", "").removeprefix("Bearer ")
        execution = scope["path"].startswith("/_native/v1/execution/")
        workers = self.execution_workers if execution else self.workers
        operations = DISCOVERY_OPERATIONS if execution else self.operations
        worker = next(
            (
                Worker(name, operations)
                for name, token in workers.items()
                if secrets.compare_digest(token.encode(), bearer.encode())
            ),
            None,
        )
        if (
            not secrets.compare_digest(proof.encode(), self.ingress.encode())
            or worker is None
            or (execution and ("origin" in headers or "cookie" in headers))
        ):
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
    permission = await identity.owner_permission(
        owner=context["owner"], permission=CLOUD_CONTROL_PERMISSION
    )
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
