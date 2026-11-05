"""Authorize and settle the fixed Mac CLI connection operations."""

from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import update

from app.capabilities.agents.cli.contracts import AgentOut, CatalogOut
from app.capabilities.agents.cli.definitions import DEFINITIONS
from app.runtime.time import utc_now
from fpl_runtime.agent_connections import (
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
from fpl_runtime.native_protocol import NativeOutcome
from fpl_runtime.native_queue import NativeQueue, NativeQueueError
from fpl_runtime.visual_catalog import AGENT_ACCEPTANCE_TARGET

from .models import ConnectionJob

WINDOW_SECONDS = 40


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
        row = await self.queue.enqueue(
            owner=owner,
            operation=operation,
            payload={
                "input": payload,
                "assertion": assertion,
                "deadline": (utc_now() + timedelta(seconds=WINDOW_SECONDS)).isoformat(),
            },
            request_id=uuid4().hex,
        )
        try:
            return await self.queue.wait(owner=owner, job_id=row["id"], timeout=WINDOW_SECONDS)
        except NativeQueueError as exc:
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(ConnectionJob)
                    .where(ConnectionJob.id == row["id"], ConnectionJob.status == "queued")
                    .values(
                        status="failed",
                        error_code="native_worker_unavailable",
                        revision=ConnectionJob.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                await session.commit()
            raise unavailable() from exc

    async def catalog(self, request, *, can_enable):
        operation = CATALOG if request.method == "GET" else DETECT
        data = CatalogRequest(show_paths=can_enable).model_dump()
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
            return row.payload["assertion"]

    async def authorize(self, worker, lease):
        assertion = await self._leased(worker, lease, admission=True)
        method, path = route_for(lease.operation, lease.payload)
        if await self._status(assertion, method, path) is not True:
            raise HTTPException(403, {"code": "authorization_revoked"})

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
