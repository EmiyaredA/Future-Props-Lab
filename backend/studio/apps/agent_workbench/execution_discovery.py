"""Dispatch exact discovery scopes to the authenticated Mac workbench executor."""

from time import monotonic, time
from uuid import uuid4

from anyio import CancelScope
from fastapi import HTTPException
from sqlalchemy import select, text, update

from studio.apps.agent_workbench.execution import transcripts
from studio.apps.agent_workbench.execution.models import WorkbenchProject
from studio.apps.agent_workbench.execution.projects import RECENT_LIMIT
from studio.apps.agent_workbench.execution.schemas import DirectoryListing, ExecutionCatalog
from studio.apps.agent_workbench.storage.service_models import WorkbenchExecutionJob
from studio.contracts.agent_workbench.execution import (
    CATALOG,
    CHECK_PROJECT,
    DIRECTORIES,
    DISCOVERY_OPERATIONS,
    PREVIEW_SOURCE,
    ROUTES,
    ProjectFileResult,
    ProjectReady,
    RecentRoot,
)
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError, digest
from studio.runtime.time import utc_now

WINDOW = 40


async def registered_project_root(db, owner, identity):
    return await db.scalar(
        select(WorkbenchProject.root).where(
            WorkbenchProject.id == identity, WorkbenchProject.owner_user_id == owner
        )
    )


async def registered_history_root(db, owner, root, *, local):
    if not local:
        return False
    return (
        await db.scalar(
            select(WorkbenchProject.id).where(
                WorkbenchProject.owner_user_id == owner, WorkbenchProject.root == root
            )
        )
    ) is not None


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
        self.previews = {}
        self.last_poll = None

    @property
    def ready(self):
        return self.configured and self.last_poll is not None and monotonic() - self.last_poll <= 15

    async def authority(self, assertion, operation, source=None):
        method, path = ("GET", source) if operation == PREVIEW_SOURCE else ROUTES[operation]
        value = await self.identity.cloud_authority(assertion=assertion, method=method, path=path)
        if value is None:
            raise HTTPException(503, "workbench_authority_unavailable")
        if not value.active:
            raise HTTPException(403, "workbench_authority_revoked")
        if operation in {CHECK_PROJECT, PREVIEW_SOURCE} and (
            not value.enabled or value.unlocked_until <= time()
        ):
            raise HTTPException(403, "请先验证密码及动态验证码")
        return value

    async def execute(self, owner, assertion, operation, scope, *, source=None):
        if not self.ready or len(self.requests) >= 32:
            raise HTTPException(503, "workbench_execution_worker_unavailable")
        identity = uuid4().hex
        key = owner, identity
        self.requests[key] = (assertion, source)
        job = result = preview = None
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
            self.requests.pop(key, None)
            preview = self.previews.pop(key, None)
            if job is not None and result is None:
                with CancelScope(shield=True):
                    await self.discard(owner, job["id"])
        current = await self.authority(assertion, operation, source)
        if not current.enabled:
            raise HTTPException(403, "workbench_execution_disabled")
        if result["status"] == "completed":
            if operation == PREVIEW_SOURCE:
                if preview is None:
                    raise HTTPException(503, "workbench_preview_unconfirmed")
                return preview
            return result["result"]
        code = result["error_code"]
        statuses = {
            "project_unavailable": 409,
            "agent_unavailable": 409,
            "project_not_found": 404,
            "source_not_found": 404,
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
        request = self.requests.get(key)
        if request is None:
            raise HTTPException(410, "workbench_execution_lease_ended")
        assertion, source = request
        current = await self.authority(assertion, lease.operation, source)
        if not current.enabled or self.requests.get(key) != request:
            raise HTTPException(403, "workbench_authority_revoked")

    async def settle(self, worker, lease, outcome):
        request_id = await self.lease(worker, lease, active=False)
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
                elif lease.operation == PREVIEW_SOURCE:
                    result = ProjectFileResult.model_validate(outcome.result)
                    if result.path != lease.payload["path"] or len(result.text.encode()) > 131_072:
                        raise ValueError("preview does not match its bound file")
                    key = lease.owner_user_id, request_id
                    if key not in self.requests:
                        raise HTTPException(410, "workbench_execution_lease_ended")
                    value = result.model_dump(mode="json")
                    if self.previews.setdefault(key, value) != value:
                        raise HTTPException(409, "workbench_preview_receipt_conflict")
                    outcome = outcome.model_copy(update={"result": {"sha256": digest(value)}})
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
