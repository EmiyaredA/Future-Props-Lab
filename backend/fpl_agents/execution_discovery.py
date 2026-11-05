"""Dispatch exact discovery scopes to the authenticated Mac workbench executor."""

from time import monotonic, time
from uuid import uuid4

from anyio import CancelScope
from fastapi import HTTPException
from sqlalchemy import select, text, update

from app.apps.agent_workbench.execution import transcripts
from app.apps.agent_workbench.execution.models import WorkbenchProject
from app.apps.agent_workbench.execution.projects import RECENT_LIMIT
from app.apps.agent_workbench.execution.schemas import DirectoryListing, ExecutionCatalog
from app.runtime.time import utc_now
from fpl_runtime.native_queue import NativeQueue, NativeQueueError
from fpl_runtime.workbench_execution import (
    CATALOG,
    CHECK_PROJECT,
    DIRECTORIES,
    DISCOVERY_OPERATIONS,
    ROUTES,
    ProjectReady,
    RecentRoot,
)

from .models import WorkbenchExecutionJob

WINDOW = 40


async def registered_project_root(db, owner, identity):
    return await db.scalar(
        select(WorkbenchProject.root).where(
            WorkbenchProject.id == identity, WorkbenchProject.owner_user_id == owner
        )
    )


async def store_verified_chat(db, owner, project, agent, label, *, local, expected_root):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    if local and await registered_project_root(db, owner, project) != expected_root:
        await db.rollback()
        raise HTTPException(409, "项目已变更，请重试")
    return await transcripts.store_chat(db, owner, project, agent, label, local=local)


async def recent_roots(db, owner):
    rows = await db.execute(
        select(WorkbenchProject.id, WorkbenchProject.root)
        .where(WorkbenchProject.owner_user_id == owner)
        .order_by(WorkbenchProject.last_used_at.desc(), WorkbenchProject.id)
        .limit(RECENT_LIMIT)
    )
    return [RecentRoot(id=identity, root=root) for identity, root in rows]


class ExecutionDiscovery:
    def __init__(self, database, identity, *, configured):
        self.database, self.identity, self.configured = database, identity, configured
        self.queue = NativeQueue(
            database, WorkbenchExecutionJob, operations=DISCOVERY_OPERATIONS, clock=utc_now
        )
        self.requests = {}
        self.last_poll = None

    @property
    def ready(self):
        return self.configured and self.last_poll is not None and monotonic() - self.last_poll <= 15

    async def authority(self, assertion, operation):
        method, path = ROUTES[operation]
        value = await self.identity.cloud_authority(assertion=assertion, method=method, path=path)
        if value is None:
            raise HTTPException(503, "workbench_authority_unavailable")
        if not value.active:
            raise HTTPException(403, "workbench_authority_revoked")
        if operation == CHECK_PROJECT and (not value.enabled or value.unlocked_until <= time()):
            raise HTTPException(403, "请先验证密码及动态验证码")
        return value

    async def execute(self, owner, assertion, operation, scope):
        if not self.ready or len(self.requests) >= 32:
            raise HTTPException(503, "workbench_execution_worker_unavailable")
        identity = uuid4().hex
        self.requests[owner, identity] = assertion
        job = result = None
        try:
            job = await self.queue.enqueue(
                owner=owner,
                operation=operation,
                payload=scope.model_dump(mode="json"),
                request_id=identity,
            )
            result = await self.queue.wait(owner=owner, job_id=job["id"], timeout=WINDOW)
        except NativeQueueError:
            raise HTTPException(503, "workbench_discovery_unconfirmed") from None
        finally:
            self.requests.pop((owner, identity), None)
            if job is not None and result is None:
                with CancelScope(shield=True):
                    await self.discard(owner, job["id"])
        current = await self.authority(assertion, operation)
        if not current.enabled:
            raise HTTPException(403, "workbench_execution_disabled")
        if result["status"] == "completed":
            return result["result"]
        code = result["error_code"]
        statuses = {
            "project_unavailable": 409,
            "agent_unavailable": 409,
            "project_not_found": 404,
            "workbench_authority_revoked": 403,
        }
        raise HTTPException(statuses.get(code, 503), {"code": code, "message": result["message"]})

    async def recover(self):
        model = WorkbenchExecutionJob
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            owners = await session.scalars(
                select(model.owner_user_id).where(model.status.in_(("queued", "leased"))).distinct()
            )
        for owner in owners:
            await self.discard(owner)

    async def discard(self, owner, identity=None):
        model = WorkbenchExecutionJob
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            scope = update(model).where(model.id == identity) if identity else update(model)
            for previous, status in (("queued", "failed"), ("leased", "unknown")):
                await session.execute(
                    scope.where(model.status == previous).values(
                        status=status,
                        error_code="workbench_request_ended",
                        revision=model.revision + 1,
                        updated_at=utc_now(),
                    )
                )
            await session.commit()

    async def claim(self, worker):
        self.last_poll = monotonic()
        return await self.queue.claim(worker_id=worker, allowed_operations=DISCOVERY_OPERATIONS)

    async def lease(self, worker, lease, *, active):
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as session:
            row = await session.get(WorkbenchExecutionJob, str(lease.job_id))
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.payload != lease.payload
                or (active and (row.status != "leased" or row.lease_expires_at <= utc_now()))
            ):
                raise HTTPException(410, "workbench_execution_lease_ended")
            return row.request_id

    async def authorize(self, worker, lease):
        request_id = await self.lease(worker, lease, active=True)
        key = lease.owner_user_id, request_id
        assertion = self.requests.get(key)
        if assertion is None:
            raise HTTPException(410, "workbench_execution_lease_ended")
        current = await self.authority(assertion, lease.operation)
        if not current.enabled or self.requests.get(key) != assertion:
            raise HTTPException(403, "workbench_authority_revoked")

    async def settle(self, worker, lease, outcome):
        await self.lease(worker, lease, active=False)
        if outcome.status == "completed":
            try:
                if lease.operation == CATALOG:
                    result = ExecutionCatalog.model_validate(outcome.result)
                    if not lease.payload["local"] and (
                        result.can_select_directory
                        or result.recent_projects
                        or result.suggested_directories
                    ):
                        raise ValueError("public directory disclosure")
                elif lease.operation == DIRECTORIES:
                    DirectoryListing.model_validate(outcome.result)
                elif lease.operation == CHECK_PROJECT:
                    project = ProjectReady.model_validate(outcome.result)
                    if project.project_id != lease.payload["project_id"]:
                        raise ValueError("project receipt identity differs")
                elif outcome.result != {"root": lease.payload["root"]}:
                    raise ValueError("project result differs from request")
            except ValueError:
                raise HTTPException(422, "workbench_execution_receipt_invalid") from None
        try:
            await self.queue.complete(
                worker_id=worker,
                lease=lease,
                outcome=outcome,
                allowed_operations=DISCOVERY_OPERATIONS,
            )
        except NativeQueueError:
            raise HTTPException(409, "workbench_execution_receipt_conflict") from None
