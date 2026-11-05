"""Integrations owns native MCP authority; a Mac receives only fixed profile executions."""

import json
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import select, text, update

from app.integrations.common import IntegrationNotStarted
from app.integrations.mcp.client import DiscoveredTool, DiscoveryResult
from app.integrations.models import McpIntegration
from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.apps.integrations.storage.native_mcp_records import NativeMcpJob, NativeMcpObservation
from studio.contracts.agent_workbench.native import NativeLease
from studio.contracts.integrations.integration_intents import digest
from studio.contracts.integrations.native import (
    OPERATIONS,
    McpHostObservation,
    McpLaunch,
    McpNativePayload,
)
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

from .records import ValidationAttempt


def public_payload(row):
    return McpNativePayload.model_validate(
        {key: value for key, value in row.payload.items() if key != "inputs"}
    )


class BoundMcpClient:
    def __init__(self, broker, run):
        self.broker, self.run = broker, run

    async def discover(self, **_options):
        result = await self.broker.invoke(
            self.run, "integrations.mcp-discover", tool_name="", inputs={}
        )
        return DiscoveryResult(
            result["server_name"],
            result["server_version"],
            result["protocol_version"],
            tuple(DiscoveredTool(**tool) for tool in result["tools"]),
        )

    async def call(self, *, tool_name, tool_arguments, **_options):
        return await self.broker.invoke(
            self.run, "integrations.mcp-call", tool_name=tool_name, inputs=tool_arguments
        )


class NativeMcpBroker(PollingTaskRunner):
    runner_name = "native-mcp-settlement"
    poll_interval_seconds = 1

    def __init__(self, database, intents, *, cipher):
        super().__init__()
        self.database, self.intents, self.cipher = database, intents, cipher
        self.queue = NativeQueue(database, NativeMcpJob, operations=OPERATIONS, clock=utc_now)

    def bound(self, run):
        return BoundMcpClient(self, run)

    async def report(self, worker, body):
        async with self.database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(NativeMcpObservation, worker)
            if row is None:
                session.add(NativeMcpObservation(id=worker, payload=body.model_dump(mode="json")))
            else:
                row.payload, row.observed_at = body.model_dump(mode="json"), utc_now()
            await session.commit()

    async def configuration(self, owner, payload):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(McpIntegration, payload.connection_id)
            if (
                row is None
                or not row.enabled
                or row.transport != "stdio"
                or row.revision != payload.connection_revision
            ):
                raise OperationError("MCP连接已停用或变化", "native_authorization_revoked", 403)
            launch_sha256 = digest({"command": row.command, "arguments": row.arguments})
            if launch_sha256 != payload.launch_sha256:
                raise OperationError("MCP原生配置摘要不一致", "native_authorization_revoked", 403)
            environment = (
                json.loads(self.cipher.decrypt(row.environment_ciphertext))
                if row.environment_ciphertext
                else {}
            )
            return SimpleNamespace(
                command=row.command,
                arguments=list(row.arguments),
                environment=environment,
                sensitive_result=row.sensitive_result,
            )

    async def active(self, owner, payload, operation):
        try:
            decision = await self.intents.check(payload.intent_id)
        except IntegrationAuthorizationUnavailable:
            raise OperationError(
                "Identity暂不可用，未获新执行权", "identity_unavailable", 503
            ) from None
        scope = decision.scope
        if not decision.allowed:
            raise OperationError("原MCP授权已撤销", "native_authorization_revoked", 403)
        expected = "mcp.validate" if operation == "integrations.mcp-discover" else "mcp.call"
        if (
            decision.actor.user_id != owner
            or scope.kind != expected
            or scope.connection_id != payload.connection_id
            or scope.connection_revision != payload.connection_revision
            or scope.input_sha256 != payload.input_sha256
            or scope.tool_name != payload.tool_name
        ):
            raise OperationError("MCP任务授权范围不一致", "native_authorization_invalid", 403)
        await self.configuration(owner, payload)

    async def invoke(self, run, operation, *, tool_name, inputs):
        if run is None or operation not in OPERATIONS:
            raise IntegrationNotStarted("MCP原生调用缺少原任务授权")
        scope = run.scope
        if digest(inputs) != scope.input_sha256 or tool_name != scope.tool_name:
            raise IntegrationNotStarted("MCP原生输入不符合原任务摘要")
        async with self.database.sessions(info={"owner_user_id": run.owner}) as session:
            row = await session.get(McpIntegration, scope.connection_id)
            if (
                row is None
                or row.revision != scope.connection_revision
                or row.transport != "stdio"
                or not row.enabled
            ):
                raise IntegrationNotStarted("MCP连接未启用或配置已经变化")
            payload = McpNativePayload(
                intent_id=run.id,
                connection_id=row.id,
                connection_revision=row.revision,
                input_sha256=scope.input_sha256,
                launch_sha256=digest({"command": row.command, "arguments": row.arguments}),
                sensitive_result=row.sensitive_result,
                tool_name=tool_name,
            )
            observations = list(
                await session.scalars(
                    select(NativeMcpObservation).where(
                        NativeMcpObservation.observed_at > utc_now() - timedelta(seconds=10)
                    )
                )
            )
            if not any(
                payload.launch_sha256 in McpHostObservation.model_validate(item.payload).profiles
                for item in observations
            ):
                raise IntegrationNotStarted("没有已连接且登记了此MCP启动配置的Mac工作进程")
        await self.active(run.owner, payload, operation)
        job = await self.queue.enqueue(
            owner=run.owner,
            operation=operation,
            payload={**payload.model_dump(mode="json"), "inputs": inputs},
            request_id=str(run.id),
        )
        try:
            result = await self.queue.wait(owner=run.owner, job_id=job["id"], timeout=25)
            if result["status"] != "completed":
                if result["status"] == "failed" and result["error_code"] in {
                    "dispatch_cancelled",
                    "authorization_revoked",
                }:
                    raise IntegrationNotStarted("原生MCP任务在执行前已取消")
                raise RuntimeError("原生MCP执行结果未确认，不会重复派发")
            await self.active(run.owner, payload, operation)
            return result["result"]
        except BaseException:
            await self.cancel_wait(run.owner, job["id"])
            raise

    async def cancel_wait(self, owner, job_id):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(NativeMcpJob, job_id)
            if row.status == "queued":
                row.status, row.error_code = "failed", "dispatch_cancelled"
            elif row.status == "leased":
                row.status, row.error_code = "unknown", "caller_wait_ended"
            await session.commit()

    async def claim(self, worker):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            observation = await session.get(NativeMcpObservation, worker)
            if observation is None or observation.observed_at < utc_now() - timedelta(seconds=10):
                return None
            profiles = McpHostObservation.model_validate(observation.payload).profiles
            row = await session.scalar(
                select(NativeMcpJob)
                .where(
                    NativeMcpJob.status == "queued",
                    NativeMcpJob.payload["launch_sha256"].as_string().in_(profiles),
                )
                .order_by(NativeMcpJob.created_at, NativeMcpJob.id)
                .limit(1)
            )
            if row is None:
                return None
            owner, payload, operation = row.owner_user_id, public_payload(row), row.operation
            job_id = row.id
        # Revalidate remotely before acquiring any writer lock. A revoked queued
        # item must not permanently block a different account's next valid job.
        try:
            await self.active(owner, payload, operation)
        except OperationError as exc:
            if exc.status != 403:
                raise
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(NativeMcpJob)
                    .where(NativeMcpJob.id == job_id, NativeMcpJob.status == "queued")
                    .values(
                        status="failed",
                        error_code="authorization_revoked",
                        revision=NativeMcpJob.revision + 1,
                    )
                )
                await session.commit()
            return None
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(NativeMcpJob, job_id)
            if row.status != "queued":
                return None
            await self.configuration(owner, payload)
            expiry = utc_now() + timedelta(seconds=90)
            row.status, row.worker_id, row.lease_id, row.lease_expires_at = (
                "leased",
                worker,
                str(uuid4()),
                expiry,
            )
            row.revision += 1
            await session.commit()
            return NativeLease(
                job_id=row.id,
                lease_id=row.lease_id,
                owner_user_id=owner,
                operation=operation,
                payload=payload.model_dump(mode="json"),
                lease_expires_at=expiry.isoformat(),
            )

    async def lease(self, worker, lease, *, execute=False):
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as session:
            row = await session.get(NativeMcpJob, str(lease.job_id))
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or public_payload(row).model_dump(mode="json") != lease.payload
            ):
                raise OperationError("MCP租约不匹配", "native_lease_ended", 410)
            if execute and (row.status != "leased" or row.lease_expires_at <= utc_now()):
                raise OperationError("MCP租约已经结束", "native_lease_ended", 410)
            return public_payload(row), dict(row.payload.get("inputs", {}))

    async def authorize(self, worker, lease):
        payload, _inputs = await self.lease(worker, lease, execute=True)
        await self.active(lease.owner_user_id, payload, lease.operation)

    async def launch(self, worker, lease):
        await self.authorize(worker, lease)
        payload, inputs = await self.lease(worker, lease, execute=True)
        configuration = await self.configuration(lease.owner_user_id, payload)
        if digest(inputs) != payload.input_sha256:
            raise OperationError("MCP输入摘要不匹配", "native_authorization_invalid", 403)
        return McpLaunch(
            command=configuration.command,
            arguments=configuration.arguments,
            environment=configuration.environment,
            tool_name=payload.tool_name,
            tool_arguments=inputs,
            sensitive_result=payload.sensitive_result,
            launch_sha256=payload.launch_sha256,
            operation=lease.operation,
        )

    async def complete(self, worker, lease, outcome):
        await self.lease(worker, lease)
        if len(json.dumps(outcome.model_dump(mode="json"))) > 1024 * 1024:
            raise NativeQueueError("native_result_too_large")
        return await self.queue.complete(
            worker_id=worker, lease=lease, outcome=outcome, allowed_operations=OPERATIONS
        )

    async def recover(self):
        # A leased task is never placed back in queued, including on service restart.
        await self.process_once()

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            rows = list(
                await session.scalars(
                    select(NativeMcpJob)
                    .join(
                        ValidationAttempt,
                        NativeMcpJob.payload["intent_id"].as_string() == ValidationAttempt.id,
                    )
                    .where(
                        NativeMcpJob.status.in_(["completed", "failed"]),
                        ValidationAttempt.status == "unknown",
                    )
                    .limit(100)
                )
            )
        for job in rows:
            payload = public_payload(job)
            async with self.database.sessions(info={"owner_user_id": job.owner_user_id}) as session:
                row = await session.get(ValidationAttempt, str(payload.intent_id))
                if row is not None and row.status == "unknown":
                    row.status = (
                        "not-started"
                        if job.error_code in {"dispatch_cancelled", "authorization_revoked"}
                        else "completed"
                    )
                    await session.commit()

    async def close(self):
        await self.stop()
