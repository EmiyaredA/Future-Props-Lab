"""Verify the exact Mac review lease, evidence package and lost receipt recovery."""

import asyncio
import hashlib
import json
from datetime import timedelta

import httpx
import pytest

from studio.apps.agent_runtime.review_artifact_sweep import ReviewArtifactSweep
from studio.apps.agent_runtime.storage.migrations.registry import MIGRATIONS
from studio.apps.visual_workshop.acceptance.execution.task_tools import MediaTools
from studio.assembly.independent.agent_runtime.application import create_app
from studio.contracts.agent_runtime.connections import (
    AcceptanceAgentCatalog,
    AcceptanceAgentStatus,
    ConnectionOptions,
)
from studio.contracts.agent_runtime.definitions import DEFINITIONS
from studio.host.agent_execution.agent_connections_worker import ConnectionWorker
from studio.host.transport import NativeTransport
from studio.host.visual_review_worker import VisualReviewWorker
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.time import utc_now
from tests.apps.agent_runtime.test_agent_runtime_service import (
    IDENTITY_TOKEN,
    INGRESS,
    TOKEN,
    NativeBridge,
)
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.apps.visual_workshop.test_visual_acceptance import submission
from tests.apps.visual_workshop.test_visual_node_review_service import (
    create_run,
    review_mesh,
    video_file,
)

SIGNATURE = "a" * 64


async def test_mac_review_replays_receipt_and_publishes_supplemental_evidence(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "agent-runtime"
    apply(root / "service.db", "agent-runtime", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["agent-runtime"] = IDENTITY_TOKEN
    runtime = create_app(
        state_root=root,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        transport=case.mesh,
        options=ConnectionOptions(
            identity_credential=IDENTITY_TOKEN, ingress=INGRESS, workers={"mac": TOKEN}
        ),
    )
    case.mesh.apps["agent-runtime"] = runtime
    bridge = NativeBridge(runtime)

    def transport():
        return NativeTransport(
            service="agent-runtime",
            base_url="http://127.0.0.1:19091/agent-runtime",
            credential=TOKEN,
            transport=bridge,
        )

    async def configured(agent, signature):
        assert agent == "codex" and signature == SIGNATURE
        return "/fixture/codex"

    async def catalog(*, probe):
        assert isinstance(probe, bool)
        return AcceptanceAgentCatalog(
            items=[
                AcceptanceAgentStatus(
                    id=agent,
                    available=agent == "codex",
                    message="fixture",
                    signature=SIGNATURE if agent == "codex" else None,
                )
                for agent in DEFINITIONS
            ]
        )

    calls = []

    async def execute(agent, executable, root, schema, tool, prompt, cancelled, *, watchdog):
        assert agent == "codex" and executable == "/fixture/codex"
        assert schema.is_file() and tool[-1] == str(root)
        assert "不可信数据" in prompt and watchdog
        assert await cancelled() is False
        tools = MediaTools(root)
        manifest = await tools.manifest()
        assert manifest["task"]["prompt"] == "Frozen source"
        sample = next(item for item in manifest["media"] if item["kind"] == "video")
        original_id = manifest["evidence"][0]["id"]
        assert len(await tools.image(original_id)) == 2
        await tools.sample(sample["id"], 200, 350, count=1)
        extra = tools.extra[0]
        calls.append((extra["id"], extra["sha256"]))
        return {
            "summary": "固定 CLI 验收夹具",
            "findings": [
                {
                    "criterion_id": row["id"],
                    "suggestion": "passed",
                    "explanation": "读取证据",
                    "evidence_ids": [original_id, extra["id"]],
                    "start_ms": 100,
                    "end_ms": 500,
                }
                for row in manifest["task"]["criteria"]
                if row["method"] == "ai"
            ],
            "limitations": ["只验证受控证据"],
        }

    connection_worker = ConnectionWorker(
        transport(),
        tmp_path / "connections",
        catalog=None,
        enable=None,
        acceptance_status=catalog,
    )
    host = tmp_path / "native-review"
    worker = VisualReviewWorker(transport(), host, executor=execute, configured=configured)
    async with (
        runtime.router.lifespan_context(runtime),
        review_mesh(case, tmp_path) as (visual, send, faults),
    ):
        poll = asyncio.create_task(connection_worker.run())
        try:
            async with visual() as app:
                path, identity, _sources = await create_run(
                    send, app, video_file(tmp_path), scheme="motion-transfer:codex"
                )
                await app.state.review_runner.run(case.viewer, identity)
                before = (await send("GET", path)).json()
                assert before["status"] == "processing", before["error_message"]
                assert before["evidence"]
                bridge.lose_next_receipt = True
                with pytest.raises(httpx.HTTPStatusError):
                    await worker.poll_once()
                assert len(calls) == 1 and not bridge.lose_next_receipt
                await worker.transport.close()
                restarted = VisualReviewWorker(
                    transport(), host, executor=execute, configured=configured
                )
                try:
                    await restarted.poll_once()
                    assert not list(restarted.receipts.pending())
                    assert len(calls) == 1
                finally:
                    await restarted.transport.close()
                faults.drop_commit = True
                with pytest.raises(CapabilityUnavailable):
                    await app.state.review_runner.run(case.viewer, identity)
            async with visual() as app:
                await app.state.review_runner.run(case.viewer, identity)
                done = (await send("GET", path)).json()
                assert done["status"] == "completed", done
                assert done["execution_result"]["kind"] == "code_agent"
                assert done["evidence"][:-1] == before["evidence"]
                extra = done["evidence"][-1]
                assert extra["id"] == calls[0][0]
                frame = await send(
                    "GET", f"/v1/files/{extra['asset_id']}/content", service="assets"
                )
                assert (
                    frame.status_code == 200
                    and hashlib.sha256(frame.content).hexdigest() == calls[0][1]
                )
                assert len(calls) == 1
                assert "fixture/codex" not in json.dumps(done)

                # Expiry removes only the managed temporary copy. Assets owns the published frame.
                artifacts = runtime.state.review_artifacts
                ((job, lease),) = artifacts.stored_leases()
                scratch = artifacts.directory(job, lease)
                nearby = scratch / "fixture-note.txt"
                nearby.write_text("keep")
                await ReviewArtifactSweep(
                    runtime.state.database, artifacts, clock=lambda: utc_now() + timedelta(hours=2)
                ).process_once()
                assert nearby.read_text() == "keep" and not list(scratch.glob("*.png"))
                original = await send(
                    "GET", f"/v1/files/{extra['asset_id']}/content", service="assets"
                )
                assert original.content == frame.content

                project = path.split("/acceptance/runs/")[0]
                node = project + "/nodes/shot/acceptance"
                context = await send("GET", node)
                response = await send(
                    "POST", node + "/runs", json=submission(context.json(), "cancel-mac")
                )
                assert response.status_code == 200, response.text
                run_id = response.json()["id"]
                await app.state.review_runner.run(case.viewer, run_id)
                run_path = project + "/acceptance/runs/" + run_id
                processing = (await send("GET", run_path)).json()
                assert processing["status"] == "processing"
                cancelled = await send(
                    "POST",
                    run_path + "/cancel",
                    params={"expected_revision": processing["revision"]},
                )
                assert cancelled.status_code == 200, cancelled.text
                no_exec = VisualReviewWorker(
                    transport(), host, executor=execute, configured=configured
                )
                try:
                    await no_exec.poll_once()
                finally:
                    await no_exec.transport.close()
                assert len(calls) == 1
        finally:
            poll.cancel()
            await asyncio.gather(poll, return_exceptions=True)
            await worker.transport.close()
