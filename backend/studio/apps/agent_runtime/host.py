"""Authorize and settle the fixed Mac CLI connection operations."""

from datetime import datetime, timedelta
from time import monotonic
from uuid import uuid4

from anyio import CancelScope
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select, update

from studio.apps.agent_runtime.storage.service_models import ConnectionJob
from studio.contracts.agent_runtime.catalog import AgentOut, CatalogOut
from studio.contracts.agent_runtime.connections import (
    ACCEPTANCE,
    CATALOG,
    DETECT,
    ENABLE,
    OPERATIONS,
    PREFIX,
    AcceptanceAgentCatalog,
    CatalogRequest,
    EnableRequest,
    EnableResult,
)
from studio.contracts.agent_runtime.definitions import DEFINITIONS
from studio.contracts.agent_workbench.native import NativeOutcome
from studio.contracts.visual_workshop.visual_catalog import AGENT_ACCEPTANCE_TARGET
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError
from studio.runtime.time import utc_now

WINDOW_SECONDS = 40
WORKER_WINDOW_SECONDS = 90
MAX_REQUESTS = 64


def route_for(operation, payload):
    if operation == ACCEPTANCE:
        return "GET", AGENT_ACCEPTANCE_TARGET
    if operation == CATALOG:
        return "GET", PREFIX
    if operation == DETECT:
        return "POST", PREFIX + "/detect"
    if operation == ENABLE:
        agent = EnableRequest.model_validate(payload).agent_id
        return "POST", f"{PREFIX}/{agent}/enable"
    raise HTTPException(403, "native_operation_forbidden")


def unavailable():
    return HTTPException(
        503, {"code": "agent_runtime_unavailable", "message": "本机 CLI 执行器不可用"}
    )


def empty_catalog():
    return CatalogOut(
        items=[
            AgentOut(
                id=item.id,
                name=item.name,
                executable="",
                version="",
                available=False,
                enabled=False,
                status="runtime_unavailable",
                message="本机 CLI 执行器不可用",
            )
            for item in DEFINITIONS.values()
        ]
    )


class ConnectionHost:
    def __init__(self, database, identity):
        self.database = database
        self.identity = identity
        self.queue = NativeQueue(database, ConnectionJob, operations=OPERATIONS, clock=utc_now)
        self.grants = {}
        self.last_poll = None

    @property
    def ready(self):
        return self.last_poll is not None and monotonic() - self.last_poll < WORKER_WINDOW_SECONDS

    async def _status(self, assertion, method, path):
        if self.identity is None:
            return None
        return await self.identity.status(assertion=assertion, method=method, path=path)

    async def run(self, request, operation, payload):
        owner = request.state.studio_principal.user_id
        assertion = request.state.service_assertion
        method, path = route_for(operation, payload)
        if (method, path) != (request.method, request.url.path):
            raise HTTPException(403, "native_operation_forbidden")
        return await self.run_bound(owner, assertion, operation, payload)

    async def run_bound(self, owner, assertion, operation, payload):
        method, path = route_for(operation, payload)
        status = await self._status(assertion, method, path)
        if status is None:
            raise unavailable()
        if not status:
            raise HTTPException(403, {"code": "authorization_revoked"})
        if len(self.grants) >= MAX_REQUESTS:
            raise unavailable()
        request_id = uuid4().hex
        key = owner, request_id
        self.grants[key] = assertion
        terminal = False
        try:
            row = await self.queue.enqueue(
                owner=owner,
                operation=operation,
                payload={
                    "input": payload,
                    "deadline": (utc_now() + timedelta(seconds=WINDOW_SECONDS)).isoformat(),
                },
                request_id=request_id,
            )
            result = await self.queue.wait(owner=owner, job_id=row["id"], timeout=WINDOW_SECONDS)
            terminal = True
            return result
        except NativeQueueError as exc:
            raise unavailable() from exc
        finally:
            self.grants.pop(key, None)
            if not terminal:
                with CancelScope(shield=True):
                    await self.retire(owner, request_id=request_id)

    async def retire(self, owner, *, request_id=None):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            for previous, status in (("queued", "failed"), ("leased", "unknown")):
                statement = update(ConnectionJob).where(ConnectionJob.status == previous)
                if request_id is not None:
                    statement = statement.where(ConnectionJob.request_id == request_id)
                await session.execute(
                    statement.values(
                        status=status,
                        error_code="agent_connection_request_ended",
                        revision=ConnectionJob.revision + 1,
                        updated_at=utc_now(),
                    )
                )
            await session.commit()

    async def recover(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            owners = list(
                await session.scalars(
                    select(ConnectionJob.owner_user_id)
                    .where(
                        or_(
                            ConnectionJob.status.in_(("queued", "leased")),
                            ConnectionJob.payload["assertion"].as_string().is_not(None),
                        )
                    )
                    .distinct()
                )
            )
        for owner in owners:
            await self.retire(owner)
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(ConnectionJob)
                    .where(ConnectionJob.payload["assertion"].as_string().is_not(None))
                    .values(payload=func.json_remove(ConnectionJob.payload, "$.assertion"))
                )
                await session.commit()

    async def catalog(self, request, *, can_enable, harness_model=None):
        operation = CATALOG if request.method == "GET" else DETECT
        data = CatalogRequest(show_paths=can_enable, harness_model=harness_model).model_dump(
            exclude_none=True
        )
        try:
            job = await self.run(request, operation, data)
        except HTTPException as exc:
            if exc.status_code == 503:
                return empty_catalog()
            raise
        if job["status"] != "completed":
            return empty_catalog()
        result = CatalogOut.model_validate(job["result"])
        result.can_enable = can_enable
        if not can_enable:
            for item in result.items:
                item.executable = ""
        return result

    async def enable(self, request, agent_id):
        job = await self.run(request, ENABLE, EnableRequest(agent_id=agent_id).model_dump())
        if job["status"] == "completed":
            EnableResult.model_validate(job["result"])
            return
        if job["error_code"] == "authorization_revoked":
            raise HTTPException(403, {"code": "authorization_revoked"})
        if job["status"] == "failed" and job["error_code"] == "connection_unavailable":
            raise HTTPException(409, "CLI 安装、登录或配置校验失败")
        raise unavailable()

    async def claim(self, worker):
        self.last_poll = monotonic()
        lease = await self.queue.claim(worker_id=worker, allowed_operations=OPERATIONS)
        if lease is not None:
            lease = lease.model_copy(update={"payload": lease.payload["input"]})
        return lease

    async def _leased(self, worker, lease, *, admission):
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as db:
            row = await db.get(ConnectionJob, str(lease.job_id))
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.payload["input"] != lease.payload
                or (
                    admission
                    and (
                        row.status != "leased"
                        or row.lease_expires_at <= utc_now()
                        or datetime.fromisoformat(row.payload["deadline"]) <= utc_now()
                    )
                )
            ):
                raise HTTPException(410, "agent_connection_lease_ended")
            return row.request_id

    async def authorize(self, worker, lease):
        request_id = await self._leased(worker, lease, admission=True)
        key = lease.owner_user_id, request_id
        assertion = self.grants.get(key)
        if assertion is None:
            raise HTTPException(410, "agent_connection_lease_ended")
        method, path = route_for(lease.operation, lease.payload)
        if (
            await self._status(assertion, method, path) is not True
            or self.grants.get(key) != assertion
        ):
            raise HTTPException(403, {"code": "authorization_revoked"})
        self.last_poll = monotonic()

    async def settle(self, worker, lease, outcome):
        await self._leased(worker, lease, admission=False)
        if outcome.status == "completed":
            try:
                if lease.operation == ENABLE:
                    data = EnableResult.model_validate(outcome.result)
                elif lease.operation == ACCEPTANCE:
                    data = AcceptanceAgentCatalog.model_validate(outcome.result)
                else:
                    data = CatalogOut.model_validate(outcome.result)
                    if tuple(item.id for item in data.items) != tuple(DEFINITIONS):
                        raise ValueError("CLI catalog does not match the fixed set")
                    if not CatalogRequest.model_validate(lease.payload).show_paths:
                        for item in data.items:
                            item.executable = ""
                outcome = NativeOutcome(status="completed", result=data.model_dump())
            except (ValidationError, ValueError):
                raise HTTPException(422, "invalid_agent_connection_receipt") from None
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations=OPERATIONS
            )
        except NativeQueueError as exc:
            raise HTTPException(409, {"code": exc.code}) from exc
