import asyncio
import json

import httpx
import pytest

from studio.apps.model_service.providers import zealman_live
from studio.apps.model_service.providers.zealman_live import ZealmanLiveMonitor, apply_event
from studio.apps.model_service.providers.zealman_progress import execution_info
from studio.apps.model_service.providers.zealman_video import get_task
from studio.contracts.model_service.task_execution import TaskExecutionInfo
from studio.runtime.time import utc_now


@pytest.mark.parametrize(
    "bucket,phase,position",
    [
        ("queue_pending", "queued", 2),
        ("queue_running", "running", None),
    ],
)
def test_queue_identity_beats_stale_ledger_without_exposing_graph(bucket, phase, position):
    queue = {bucket: [[0, "other", {}], [1, "target", {"secret": "do not expose"}]]}
    info = execution_info("target", {"status": "running", "progress": 5}, queue)
    assert (info.phase, info.queue_position) == (phase, position)
    assert info.reported_progress == 5
    assert "secret" not in info.model_dump_json()
    assert execution_info("lost", {"status": "running"}, queue).phase == "unknown"
    assert execution_info("target", {"status": "running"}, None).phase == "running"


@pytest.mark.parametrize("progress", [-1, 101, float("nan"), "30", True, None])
def test_malformed_progress_is_not_guessed(progress):
    assert execution_info("t", {"progress": progress}, None).reported_progress is None


def test_live_events_are_scoped_and_sampling_resets_between_nodes():
    info = TaskExecutionInfo(updated_at=utc_now())

    def event(kind, **data):
        return {"type": kind, "data": {"prompt_id": "t", **data}}

    info = apply_event(info, event("progress", node="7", value=8, max=10), "t")
    assert info.model_dump(mode="json")["last_event_at"].endswith("Z")
    assert info.model_dump(mode="json")["updated_at"].endswith("Z")
    assert (info.phase, info.node_id, info.step, info.total_steps) == ("running", "7", 8, 10)
    for message in [
        {"type": "progress", "data": {"node": "9", "value": 1, "max": 2}},
        {"type": "progress", "data": {"prompt_id": "another", "node": "9"}},
        event("execution_success"),
        event("kj_preview_override", preview="private"),
        event("progress", node="7", value=100, max=10),
    ]:
        changed = apply_event(info, message, "t")
        assert changed.step == info.step
        assert changed.phase == "running"
    info = apply_event(info, event("executing", node="8"), "t")
    assert info.node_id == "8" and info.step is None
    info = apply_event(
        info,
        event(
            "progress_state",
            nodes={
                "9": {"state": "running", "value": 3, "max": 5},
            },
        ),
        "t",
    )
    assert info.step == 3 and info.node_id == "9"
    assert apply_event(info, event("executing", node=None), "t").phase == "finalizing"


@pytest.mark.asyncio
async def test_http_polling_exposes_queue_and_optional_endpoints_can_fail():
    def respond(request):
        if request.url.path.endswith("/result"):
            return httpx.Response(200, json={"pending": True})
        if request.url.path.endswith("/history"):
            return httpx.Response(200, json={})
        if request.url.path.endswith("/queue"):
            return httpx.Response(200, json={"queue_pending": [[0, "other"], [1, "t"]]})
        return httpx.Response(503)

    status = await get_task(
        base_url="https://example.test",
        api_key="",
        task_id="t",
        transport=httpx.MockTransport(respond),
    )
    assert status.status == "pending" and status.progress == 0
    assert status.execution_info.queue_position == 2

    def unsupported(request):
        if request.url.path.endswith("/result"):
            return httpx.Response(200, json={"pending": True})
        if request.url.path.endswith("/history"):
            return httpx.Response(200, json={})
        raise httpx.ConnectError("offline")

    status = await get_task(
        base_url="https://example.test",
        api_key="",
        task_id="t",
        transport=httpx.MockTransport(unsupported),
    )
    assert status.status == "pending" and status.execution_info.phase == "unknown"


@pytest.mark.asyncio
async def test_monitor_owns_socket_and_closes_without_reusing_console_client(monkeypatch):
    opened = []
    received = asyncio.Event()
    stopped = asyncio.Event()

    class Socket:
        count = 0

        async def recv(self):
            self.count += 1
            if self.count == 1:
                return b"ignored preview"
            if self.count == 2:
                return json.dumps(
                    {
                        "type": "progress",
                        "data": {
                            "prompt_id": "other",
                            "node": "8",
                            "value": 9,
                            "max": 10,
                        },
                    }
                )
            if self.count == 3:
                return json.dumps(
                    {
                        "type": "progress",
                        "data": {
                            "prompt_id": "t",
                            "node": "7",
                            "value": 8,
                            "max": 10,
                        },
                    }
                )
            received.set()
            await asyncio.Future()

    class Connection:
        async def __aenter__(self):
            return Socket()

        async def __aexit__(self, *_args):
            stopped.set()

    def connect(url, **kwargs):
        opened.append((url, kwargs))
        return Connection()

    monkeypatch.setattr(zealman_live, "connect", connect)
    monitor = ZealmanLiveMonitor()
    args = dict(
        root="https://example.test:8443",
        api_key="secret",
        task_id="t",
        info=TaskExecutionInfo(phase="running", updated_at=utc_now()),
        graph={"7": {"class_type": "SamplerCustom", "inputs": {"token": "secret"}}},
    )
    assert monitor.observe(**args, client_id="workflow-api-user").live_status == "unavailable"
    assert not opened
    monitor.observe(**args, client_id="fpl-owned")
    await asyncio.wait_for(received.wait(), 1)
    info = monitor.observe(**args, client_id="fpl-owned")
    assert info.live_status == "connected" and info.step == 8
    assert info.node_label == "SamplerCustom" and "secret" not in info.model_dump_json()
    assert "wss://example.test:8443/comfyui-ws?clientId=fpl-owned" == opened[0][0]
    await monitor.forget(args["root"], "t")
    assert stopped.is_set() and not monitor._subscriptions
    await monitor.close()


@pytest.mark.asyncio
async def test_socket_failure_falls_back_without_failing_the_task(monkeypatch):
    attempted = asyncio.Event()

    def offline(*_args, **_kwargs):
        attempted.set()
        raise OSError("disconnected")

    monkeypatch.setattr(zealman_live, "connect", offline)
    monitor = ZealmanLiveMonitor()
    args = dict(
        root="https://example.test",
        api_key="",
        task_id="t",
        client_id="fpl-owned",
        info=TaskExecutionInfo(phase="running", updated_at=utc_now()),
        graph={},
    )
    monitor.observe(**args)
    await asyncio.wait_for(attempted.wait(), 1)
    assert monitor.observe(**args).live_status == "reconnecting"
    await monitor.close()
