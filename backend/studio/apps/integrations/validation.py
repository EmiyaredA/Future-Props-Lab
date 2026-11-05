"""Fixed validation attempts preserve shared capacity and never restart ambiguous outbound work."""

import asyncio
import contextlib
from uuid import uuid4

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from app.integrations.common import IntegrationNotStarted
from app.integrations.models import McpIntegration, ToolApiIntegration
from app.integrations.schemas import (
    ToolApiValidateIn,
    ValidationAttemptListOut,
    ValidationAttemptOut,
    ValidationReconcileOut,
)
from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.apps.integrations.storage.native_mcp_records import NativeMcpJob
from studio.contracts.identity.claims import HEADER
from studio.contracts.integrations.integration_intents import IntegrationScope, digest
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

from .records import ValidationAttempt


class ValidationCapacityClient:
    def __init__(self, intents, *, base_url="http://models:8080", transport=None):
        self.intents = intents
        self.client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=5,
        )

    async def change(self, intent_id, operation, *, outcome=None):
        assertion = await self.intents.capacity_grant(intent_id, operation)
        try:
            response = await self.client.post(
                f"/_internal/v1/integration-capacity/{intent_id}/{operation}",
                headers={HEADER: assertion},
                json={"outcome": outcome} if outcome else None,
            )
            if response.status_code == 429:
                raise HTTPException(429, {"code": "runtime_quota_exceeded"})
            response.raise_for_status()
            value = response.json()
            if operation == "acquire" and value.get("released") is not False:
                raise ValueError("capacity already released")
            if operation == "release" and value.get("released") is not True:
                raise ValueError("capacity receipt unavailable")
        except (httpx.HTTPError, ValueError, AttributeError):
            raise IntegrationAuthorizationUnavailable("集成验证额度暂不可用") from None

    async def demo_reply(self, intent_id, tool, inputs):
        assertion = await self.intents.capacity_grant(intent_id, "demo")
        try:
            response = await self.client.post(
                f"/_internal/v1/integration-capacity/{intent_id}/demo",
                headers={HEADER: assertion},
                json={"tool": tool, "input": inputs},
            )
            if response.status_code == 503:
                raise RuntimeError("演示工具暂不可用，请在管理页面启用")
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise IntegrationAuthorizationUnavailable("演示工具调用未确认") from None

    async def close(self):
        await self.client.aclose()


class ValidationRun:
    def __init__(self, database, intents, capacity, attempt_id, owner, scope):
        self.database, self.intents, self.capacity = database, intents, capacity
        self.id, self.owner, self.scope = attempt_id, owner, scope

    async def transition(self, previous, status):
        async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ValidationAttempt, self.id)
            if row is None or row.status not in previous:
                raise HTTPException(409, "integration_validation_outcome_uncertain")
            row.status, row.updated_at = status, utc_now()
            await session.commit()

    async def live(self):
        model = McpIntegration if self.scope.kind.startswith("mcp.") else ToolApiIntegration
        async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
            row = await session.get(model, self.scope.connection_id)
            if row is None or row.revision != self.scope.connection_revision:
                raise HTTPException(409, "integration_validation_configuration_changed")
        decision = await self.intents.check(self.id)
        if (
            decision.scope != self.scope
            or decision.actor.user_id != self.owner
            or not decision.allowed
        ):
            raise HTTPException(403, "integration_authorization_revoked")

    async def run(self, snapshot, inputs, operation):
        if (
            snapshot.revision != self.scope.connection_revision
            or digest(inputs) != self.scope.input_sha256
        ):
            raise HTTPException(409, "integration_validation_configuration_changed")
        await self.live()
        await self.transition({"prepared"}, "running")

        async def watch():
            while True:
                await asyncio.sleep(1)
                await self.live()

        task = asyncio.create_task(operation())
        watcher = asyncio.create_task(watch())
        try:
            done, _ = await asyncio.wait({task, watcher}, return_when=asyncio.FIRST_COMPLETED)
            if watcher in done:
                await watcher
                raise HTTPException(503, "integration_authorization_unavailable")
            result = await task
            await self.live()
            await self.transition({"running"}, "completed")
            return result
        except IntegrationNotStarted:
            await self.transition({"running"}, "not-started")
            raise
        except BaseException:
            # Never repeat an outbound attempt after cancellation, timeout or a lost reply.
            with contextlib.suppress(Exception):
                await self.transition({"running"}, "unknown")
            raise
        finally:
            for pending in (task, watcher):
                pending.cancel()
            await asyncio.gather(task, watcher, return_exceptions=True)

    async def settle(self):
        async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ValidationAttempt, self.id)
            if row.status == "prepared":
                row.status = "not-started"
            status = row.status
            await session.commit()
        if status in {"completed", "not-started"}:
            await self.capacity.change(self.id, "release", outcome=status)
            async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
                row = await session.get(ValidationAttempt, self.id)
                row.released = True
                await session.commit()


async def prepare(request, session, principal):
    import re

    match = re.fullmatch(
        r"/v1/integrations/(mcp|tool-apis)/([A-Za-z0-9_-]{1,100})/validate", request.url.path
    )
    if request.method != "POST" or match is None:
        return None
    model = McpIntegration if match[1] == "mcp" else ToolApiIntegration
    row = await session.get(model, match[2])
    if row is None or row.owner_user_id != principal.owner_user_id:
        raise HTTPException(404, "integration_not_found")
    try:
        inputs = (
            {}
            if match[1] == "mcp"
            else ToolApiValidateIn.model_validate(await request.json()).input
        )
        input_sha256 = digest(inputs)
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(422, "invalid_integration_input") from None
    task_id = uuid4()
    scope = IntegrationScope(
        kind="mcp.validate" if match[1] == "mcp" else "tool.validate",
        task_id=task_id,
        connection_id=row.id,
        connection_revision=row.revision,
        input_sha256=input_sha256,
    )
    await session.rollback()
    intents = request.app.state.integration_intents
    receipt = await intents.enroll(
        request_id=task_id,
        assertion=request.state.service_assertion,
        method=request.method,
        path=request.url.path,
        scope=scope,
    )
    database, capacity = request.app.state.database, request.app.state.validation_capacity
    async with database.sessions(info={"owner_user_id": principal.owner_user_id}) as owned:
        owned.add(
            ValidationAttempt(
                id=str(receipt.id),
                owner_user_id=principal.owner_user_id,
                scope=scope.model_dump(mode="json"),
                status="prepared",
            )
        )
        await owned.commit()
    run = ValidationRun(
        database, intents, capacity, str(receipt.id), principal.owner_user_id, scope
    )
    request.state.integration_validation = run
    try:
        await capacity.change(receipt.id, "acquire")
    except BaseException:
        # No outbound work was dispatched, so even an uncertain acquire can be tombstoned.
        with contextlib.suppress(Exception):
            await run.settle()
        raise
    return run


class ValidationRecovery(PollingTaskRunner):
    runner_name = "integration-validation-settlement"

    def __init__(self, database, intents, capacity):
        super().__init__()
        self.database, self.intents, self.capacity = database, intents, capacity

    async def list_pending(self, owner, *, offset=0):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            rows = list(
                await session.scalars(
                    select(ValidationAttempt)
                    .where(
                        ValidationAttempt.owner_user_id == owner,
                        ValidationAttempt.released.is_(False),
                        ValidationAttempt.status.in_(["unknown", "completed", "not-started"]),
                    )
                    .order_by(ValidationAttempt.created_at, ValidationAttempt.id)
                    .offset(offset)
                    .limit(101)
                )
            )
            return ValidationAttemptListOut(
                has_more=len(rows) > 100,
                items=[
                    ValidationAttemptOut(
                        id=row.id,
                        kind=row.scope["kind"],
                        connection_id=row.scope["connection_id"],
                        status=row.status,
                        released=row.released,
                        created_at=row.created_at,
                    )
                    for row in rows[:100]
                ],
            )

    async def reconcile(self, owner, attempt_id):
        # A user assertion, an expired lease, or a timeout is not proof that an
        # external action has stopped. Only a durable native terminal receipt or
        # a pre-dispatch cancellation permits releasing the original capacity.
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ValidationAttempt, attempt_id)
            if row is None or row.owner_user_id != owner:
                raise HTTPException(
                    404, {"code": "integration_validation_not_found", "message": "验证记录不存在"}
                )
            if row.status == "unknown":
                job = await session.scalar(
                    select(NativeMcpJob).where(
                        NativeMcpJob.owner_user_id == owner,
                        NativeMcpJob.request_id == attempt_id,
                    )
                )
                if job is None or job.operation != "integrations.mcp-discover":
                    raise HTTPException(
                        409,
                        {
                            "code": "integration_validation_evidence_pending",
                            "message": "尚未收到可信结束回执，额度继续保留",
                        },
                    )
                expected = IntegrationScope.model_validate(row.scope)
                # Only a receipt for this exact original input and connection
                # can discharge its reservation; malformed evidence fails closed.
                payload = job.payload
                if (
                    payload.get("intent_id") != attempt_id
                    or payload.get("connection_id") != expected.connection_id
                    or payload.get("connection_revision") != expected.connection_revision
                    or payload.get("input_sha256") != expected.input_sha256
                    or expected.kind != "mcp.validate"
                ):
                    raise HTTPException(
                        409,
                        {
                            "code": "integration_validation_evidence_pending",
                            "message": "尚未收到可信结束回执，额度继续保留",
                        },
                    )
                no_dispatch = (
                    job.status == "failed"
                    and job.error_code in {"dispatch_cancelled", "authorization_revoked"}
                    and not job.worker_id
                )
                terminal_receipt = job.status in {"completed", "failed"} and bool(
                    job.outcome_sha256
                )
                if not (no_dispatch or terminal_receipt):
                    raise HTTPException(
                        409,
                        {
                            "code": "integration_validation_evidence_pending",
                            "message": "尚未收到可信结束回执，额度继续保留",
                        },
                    )
                row.status = "not-started" if no_dispatch else "completed"
                row.updated_at = utc_now()
            if row.status not in {"completed", "not-started"}:
                raise HTTPException(
                    409,
                    {
                        "code": "integration_validation_evidence_pending",
                        "message": "尚未收到可信结束回执，额度继续保留",
                    },
                )
            status, scope, released = row.status, row.scope, row.released
            await session.commit()
        if not released:
            run = ValidationRun(
                self.database,
                self.intents,
                self.capacity,
                attempt_id,
                owner,
                IntegrationScope.model_validate(scope),
            )
            try:
                await run.settle()
            except IntegrationAuthorizationUnavailable:
                # Persisted terminal evidence is retried by the normal outbox.
                return ValidationReconcileOut(id=attempt_id, status=status, released=False)
            released = True
        return ValidationReconcileOut(id=attempt_id, status=status, released=released)

    async def recover(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            rows = list(await session.scalars(select(ValidationAttempt)))
        for row in rows:
            if row.status in {"running", "prepared"}:
                run = ValidationRun(
                    self.database,
                    self.intents,
                    self.capacity,
                    row.id,
                    row.owner_user_id,
                    IntegrationScope.model_validate(row.scope),
                )
                await run.transition(
                    {row.status}, "unknown" if row.status == "running" else "not-started"
                )

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            rows = list(
                await session.scalars(
                    select(ValidationAttempt).where(
                        ValidationAttempt.released.is_(False),
                        ValidationAttempt.status.in_(["completed", "not-started"]),
                    )
                )
            )
        for row in rows:
            run = ValidationRun(
                self.database,
                self.intents,
                self.capacity,
                row.id,
                row.owner_user_id,
                IntegrationScope.model_validate(row.scope),
            )
            await run.settle()
        return bool(rows)
