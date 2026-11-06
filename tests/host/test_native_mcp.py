"""Native MCP uses exact host profiles, lease-only HTTP and durable non-replay receipts."""

import asyncio
import contextlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from studio.apps.integrations.records import ValidationAttempt
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.apps.integrations.storage.native_mcp_records import NativeMcpJob
from studio.assembly.independent.integrations.application import create_app
from studio.config.settings import Settings
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.integrations.integration_intents import IntegrationScope, digest
from studio.host.integrations.mcp_control import McpControl
from studio.host.integrations.mcp_worker import McpWorker
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from studio.runtime.database.operation_receipts import OperationError
from tests.apps.integrations.test_integrations_application import Ports


@pytest.fixture
async def case(tmp_path):
    settings = Settings(
        _config_file=None,
        fpl_database_path=str(tmp_path / "service.db"),
        fpl_secrets_key=Fernet.generate_key().decode(),
    )
    apply(settings.database_path, "integrations", MIGRATIONS)
    key, port = Ed25519PrivateKey.generate(), Ports()
    port.actor = Actor(
        user_id="alpha",
        platform_role="user",
        auth_kind="session",
        scopes=tuple(sorted(role_scopes("user"))),
        session_id="session-alpha",
    )
    app = create_app(
        settings=settings,
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
        public_key=key.public_key(),
        identity=port,
        intents=port,
        capacity=port,
        native_ingress="i" * 48,
        native_workers={"mac": "w" * 48},
        run_tasks=False,
    )
    transport = httpx.ASGITransport(app=app)
    native_transport = NativeTransport(
        base_url="http://127.0.0.1:19100/integrations",
        credential="w" * 48,
        service="integrations",
        transport=transport,
    )

    # The actual trusted gateway strips the service prefix and injects ingress proof.
    class Lane:
        async def post(self, operation, body):
            async with httpx.AsyncClient(transport=transport, base_url="http://native") as client:
                response = await client.post(
                    "/_native/v1/" + operation,
                    json=body,
                    headers={
                        "Authorization": "Bearer " + "w" * 48,
                        "X-Fpl-Native-Ingress": "i" * 48,
                    },
                )
                response.raise_for_status()
                return response.json()

        async def close(self):
            pass

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:

            async def call(method, path, **kwargs):
                return await client.request(
                    method,
                    path,
                    headers={
                        "X-Fpl-Context": issue_context(
                            port.actor,
                            service="integrations",
                            method=method,
                            path=path,
                            private_key=key,
                            key_id="test",
                        )
                    },
                    **kwargs,
                )

            yield SimpleNamespace(
                app=app, port=port, client=client, call=call, lane=Lane(), root=tmp_path
            )
    await native_transport.close()


async def prepare_job(case, *, arguments=None):
    args = arguments or ["-c", "pass"]
    created = await case.call(
        "POST",
        "/v1/integrations/mcp",
        json={
            "name": "Native",
            "transport": "stdio",
            "command": sys.executable,
            "arguments": args,
            "environment": {"FIXTURE_SECRET": "private-value"},
        },
    )
    assert created.status_code == 201, created.text
    row = created.json()
    scope = IntegrationScope(
        kind="mcp.validate",
        task_id=uuid4(),
        connection_id=row["id"],
        connection_revision=row["revision"],
        input_sha256=digest({}),
    )
    receipt = await case.port.enroll(scope=scope)
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(
            ValidationAttempt(
                id=str(receipt.id),
                owner_user_id="alpha",
                scope=scope.model_dump(mode="json"),
                status="running",
            )
        )
        await session.commit()
    run = SimpleNamespace(id=str(receipt.id), scope=scope, owner="alpha")
    profile = {"command": sys.executable, "arguments": args, "environment_keys": ["FIXTURE_SECRET"]}
    return run, profile


async def wait_for_job(case):
    async with asyncio.timeout(5):
        while True:
            result = await case.lane.post("claim", {"wait_seconds": 0})
            if result["lease"]:
                return NativeLease.model_validate(result["lease"])
            await asyncio.sleep(0.05)


async def test_real_stdio_discovery_lost_receipt_reply_and_restart_do_not_repeat(case, monkeypatch):
    server = case.root / "fixture.py"
    server.write_text("""import os,json
from pathlib import Path
from mcp.server import MCPServer
p=Path(__file__).with_suffix('.count')
p.write_text(str(int(p.read_text())+1) if p.exists() else '1')
server=MCPServer('native-fixture')
@server.tool()
def safe() -> str:
    return os.environ['FIXTURE_SECRET']
server.run(transport='stdio')
""")
    run, profile = await prepare_job(case, arguments=[str(server)])
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    broker = case.app.state.native_mcp
    pending = asyncio.create_task(broker.bound(run).discover())
    lease = await wait_for_job(case)
    assert "private-value" not in json.dumps(lease.model_dump(mode="json"))
    worker = McpWorker(case.lane, control, case.root / "worker")
    outcome = await worker.execute(lease)
    assert outcome.status == "completed", outcome
    assert outcome.result["server_name"] == "native-fixture"
    original = case.lane.post
    lost = True

    async def lose_reply(operation, body):
        nonlocal lost
        result = await original(operation, body)
        if operation == "receipt" and lost:
            lost = False
            raise httpx.ReadError("reply lost after commit")
        return result

    monkeypatch.setattr(case.lane, "post", lose_reply)
    with pytest.raises(httpx.ReadError):
        await worker.deliver(lease, outcome)
    discovery = await pending
    assert discovery.tools[0].name == "safe"
    restarted = McpWorker(case.lane, control, case.root / "worker")
    for old, stored in restarted.receipts.pending():
        await restarted.deliver(old, NativeOutcome.model_validate(stored))
    assert list(restarted.receipts.pending()) == []
    assert server.with_suffix(".count").read_text() == "1"
    assert (await original("claim", {"wait_seconds": 0}))["lease"] is None
    body = json.dumps(outcome.model_dump(mode="json"))
    assert "private-value" not in body
    async with broker.database.sessions(info={"owner_user_id": "alpha"}) as session:
        job = await session.scalar(select(NativeMcpJob))
        assert job.status == "completed" and "environment" not in job.payload


async def test_native_channel_profile_owner_input_and_revocation_are_bound(case):
    run, profile = await prepare_job(case)
    broker = case.app.state.native_mcp
    assert (
        await case.client.post("/_native/v1/claim", json={"wait_seconds": 0})
    ).status_code == 403
    await case.lane.post("report", {"profiles": ["a" * 64]})
    with pytest.raises(Exception, match="没有已连接"):
        await broker.bound(run).discover()
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    pending = asyncio.create_task(broker.bound(run).discover())
    lease = await wait_for_job(case)
    changed = lease.model_copy(update={"owner_user_id": "beta"})
    with pytest.raises(OperationError):
        await broker.authorize("mac", changed)
    changed = lease.model_copy(update={"payload": {**lease.payload, "input_sha256": "b" * 64}})
    with pytest.raises(OperationError):
        await broker.authorize("mac", changed)
    case.port.active_value = False
    with pytest.raises(OperationError, match="授权已撤销"):
        await broker.launch("mac", lease)
    pending.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await pending
    await broker.recover()
    assert (await case.lane.post("claim", {"wait_seconds": 0}))["lease"] is None
    async with broker.database.sessions(info={"owner_user_id": "alpha"}) as session:
        job = await session.scalar(select(NativeMcpJob))
        assert job.status == "unknown"
    await broker.complete("mac", lease, NativeOutcome(status="unknown", error_code="interrupted"))
    await broker.recover()
    async with broker.database.sessions(info={"owner_user_id": "alpha"}) as session:
        attempt = await session.get(ValidationAttempt, run.id)
        assert not attempt.released


async def test_host_rejects_unregistered_launch_and_environment(case):
    run, profile = await prepare_job(case)
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    pending = asyncio.create_task(case.app.state.native_mcp.bound(run).discover())
    lease = await wait_for_job(case)
    launch = await case.app.state.native_mcp.launch("mac", lease)
    with pytest.raises(ValueError, match="executable or arguments"):
        await control.execute(
            lease, launch.model_copy(update={"arguments": ["-c", "print('changed')"]}).model_dump()
        )
    with pytest.raises(ValueError, match="environment keys"):
        await control.execute(
            lease,
            launch.model_copy(update={"environment": {"PYTHONPATH": "/personal"}}).model_dump(),
        )
    pending.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await pending


async def test_public_validation_uses_native_binding_and_settles_capacity(case):
    profile = {
        "command": sys.executable,
        "arguments": ["-c", "pass"],
        "environment_keys": ["FIXTURE_SECRET"],
    }
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    created = await case.call(
        "POST",
        "/v1/integrations/mcp",
        json={
            "name": "Public native",
            "transport": "stdio",
            "command": sys.executable,
            "arguments": profile["arguments"],
        },
    )
    assert created.status_code == 201, created.text
    pending = asyncio.create_task(
        case.call("POST", f"/v1/integrations/mcp/{created.json()['id']}/validate")
    )
    lease = await wait_for_job(case)
    await case.lane.post(
        "receipt",
        {
            "lease": lease.model_dump(mode="json"),
            "outcome": NativeOutcome(
                status="completed",
                result={
                    "server_name": "public-native",
                    "server_version": "1",
                    "protocol_version": "2025-06-18",
                    "tools": [
                        {
                            "name": "safe",
                            "description": "Native tool",
                            "input_schema": {"type": "object"},
                        }
                    ],
                },
            ).model_dump(mode="json"),
        },
    )
    response = await pending
    assert response.status_code == 200, response.text
    assert response.json()["check"]["ok"] and response.json()["tools"][0]["name"] == "safe"
    assert [item[1:] for item in case.port.changes] == [("acquire", None), ("release", "completed")]


async def test_worker_cancellation_records_unknown_and_never_restarts_action(case):
    run, profile = await prepare_job(case)
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    broker = case.app.state.native_mcp
    pending = asyncio.create_task(broker.bound(run).discover())
    lease = await wait_for_job(case)
    entered, closed = asyncio.Event(), asyncio.Event()
    calls = 0

    async def slow(*_args):
        nonlocal calls
        calls += 1
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    control.execute = slow
    worker = McpWorker(case.lane, control, case.root / "worker")
    execution = asyncio.create_task(worker.execute(lease))
    await asyncio.wait_for(entered.wait(), 2)
    execution.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await execution
    await asyncio.wait_for(closed.wait(), 2)
    old, stored = next(worker.receipts.pending())
    assert stored["status"] == "unknown"
    restarted = McpWorker(case.lane, control, case.root / "worker")
    outcome = await restarted.execute(old)
    assert outcome.status == "unknown" and calls == 1
    await restarted.deliver(old, outcome)
    with pytest.raises(RuntimeError, match="不会重复派发"):
        await pending


async def test_revoked_queued_job_is_cancelled_before_host_claim(case):
    run, profile = await prepare_job(case)
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    broker = case.app.state.native_mcp
    pending = asyncio.create_task(broker.bound(run).discover())
    async with asyncio.timeout(3):
        while True:
            async with broker.database.sessions(info={"owner_user_id": "alpha"}) as session:
                row = await session.scalar(select(NativeMcpJob))
                if row is not None:
                    break
            await asyncio.sleep(0.05)
    case.port.active_value = False
    assert (await case.lane.post("claim", {"wait_seconds": 0}))["lease"] is None
    with pytest.raises(Exception, match="执行前已取消"):
        await pending
    async with broker.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.scalar(select(NativeMcpJob))
        assert row.status == "failed" and not row.lease_id


async def test_worker_shutdown_waits_for_actual_delayed_control_cleanup(case):
    run, profile = await prepare_job(case)
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    pending = asyncio.create_task(case.app.state.native_mcp.bound(run).discover())
    lease = await wait_for_job(case)
    entered, cleaning, release, closed = [asyncio.Event() for _ in range(4)]

    async def slow(*_args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaning.set()
            await release.wait()
            closed.set()

    control.execute = slow
    worker = McpWorker(case.lane, control, case.root / "worker")
    execution = asyncio.create_task(worker.execute(lease))
    await asyncio.wait_for(entered.wait(), 10)
    execution.cancel()
    await asyncio.wait_for(cleaning.wait(), 2)
    await asyncio.sleep(0.05)
    assert not execution.done() and not closed.is_set()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(execution, 2)
    assert closed.is_set()
    assert next(worker.receipts.pending())[1]["status"] == "unknown"
    pending.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await pending


async def test_cancelled_real_stdio_call_leaves_no_native_child(case):
    import os

    script = case.root / "slow-server.py"
    pid_file = script.with_suffix(".pid")
    script.write_text("""import asyncio,os
from pathlib import Path
from mcp.server import MCPServer
server=MCPServer('slow-native-fixture')
@server.tool()
async def slow_fixture() -> str:
    Path(__file__).with_suffix('.pid').write_text(str(os.getpid()))
    await asyncio.Event().wait()
    return 'never'
server.run(transport='stdio')
""")
    run, profile = await prepare_job(case, arguments=[str(script)])
    run.scope = run.scope.model_copy(update={"kind": "mcp.call", "tool_name": "slow_fixture"})
    case.port.scopes[run.id] = run.scope
    control = McpControl([profile], case.root / "worker")
    await case.lane.post("report", control.observe())
    pending = asyncio.create_task(
        case.app.state.native_mcp.bound(run).call(tool_name="slow_fixture", tool_arguments={})
    )
    lease = await wait_for_job(case)
    worker = McpWorker(case.lane, control, case.root / "worker")
    execution = asyncio.create_task(worker.execute(lease))
    async with asyncio.timeout(5):
        while not pid_file.exists():
            await asyncio.sleep(0.02)
    child = int(pid_file.read_text())
    execution.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(execution, 10)
    with pytest.raises(ProcessLookupError):
        os.kill(child, 0)
    assert next(worker.receipts.pending())[1]["status"] == "unknown"
    pending.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await pending
