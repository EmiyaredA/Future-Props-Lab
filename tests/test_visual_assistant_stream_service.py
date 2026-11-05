"""Exercise the native stream and approval over the published Visual routes."""

import asyncio
import json

import pytest
from fastapi.responses import JSONResponse
from sqlalchemy import select
from tests.test_community_asset_protocol import scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize
from tests.test_visual_assistant_submission import SECRET
from tests.test_visual_node_review_service import review_mesh

from app.capabilities.agents.harness import ModelTextDelta, ModelTurnEnd, ToolCall, Usage
from app.llm.models import LlmCallLog, ModelEntry
from studio.apps.model_service.assistant_model_runs import AssistantModelRuns
from studio.apps.model_service.transport.assistant_model_http import router
from studio.apps.visual_workshop.storage.models import VisualAssistantAction
from studio.contracts.identity.claims import HEADER
from studio.contracts.visual_workshop.visual_assistant import SOURCE
from studio.contracts.visual_workshop.visual_assistant_model import SETTLEMENT_DOMAIN
from studio.runtime.messaging.timed_peer import TimedPeer
from studio.runtime.project_errors import ProjectResourceError


async def stream(app, case, source, body, listener):
    assertion = (await authorize(case, "visual", "POST", source))[HEADER]
    frames = []

    async def receive():
        return {"type": "http.request", "body": json.dumps(body).encode()}

    async def send(message):
        if message["type"] == "http.response.start":
            assert message["status"] == 200
            assert dict(message["headers"])[b"content-type"].startswith(b"text/event-stream")
        elif (data := message.get("body", b"")).startswith(b"data: "):
            frame = json.loads(data[6:])
            frames.append(frame)
            await listener(frame)

    async with asyncio.timeout(15):
        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0", "spec_version": "2.4"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "root_path": "",
                "path": source,
                "query_string": b"",
                "headers": [
                    (HEADER.encode(), assertion.encode()),
                    (b"content-type", b"application/json"),
                ],
                "client": ("127.0.0.1", 40000),
                "server": ("visual", 80),
            },
            receive,
            send,
        )
    return frames


@pytest.mark.parametrize("case_mode", ["approved", "changed", "revoked"])
async def test_native_visual_stream_approval_and_canvas_cas(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
    case_mode,
):
    case = scenario
    changed = case_mode == "changed"
    revoked = case_mode == "revoked"
    calls = []

    class Adapter:
        def __init__(self, **_):
            pass

        async def stream_turn(self, *, round_index, messages, tools, **_):
            calls.append(round_index)
            assert len(tools) == 6
            if round_index == 0:
                yield ModelTurnEnd(
                    (
                        ToolCall(
                            "write-1",
                            "apply_canvas_changes",
                            {
                                "operations": [
                                    {
                                        "op": "add",
                                        "node": {
                                            "id": "from-assistant",
                                            "kind": "text",
                                            "title": "Assistant",
                                            "position": {"x": 80, "y": 120},
                                            "text": "Approved edit",
                                        },
                                    }
                                ]
                            },
                        ),
                    )
                )
            elif round_index == 1 and changed:
                assert "画布已经变化" in messages[-1].text
                yield ModelTurnEnd((ToolCall("read-2", "read_canvas", {}),))
            else:
                assert ("当前画布 revision=1" if changed else "已更新画布") in messages[-1].text
                yield ModelTextDelta("模型答复")
                yield ModelTurnEnd(usage=Usage(5, 8, 13))

    monkeypatch.setattr(
        "studio.apps.model_service.assistant_model_runs.decrypt_secret", lambda _: "fixture"
    )
    monkeypatch.setattr("studio.apps.model_service.assistant_model_runs.HttpAgentAdapter", Adapter)
    peer = TimedPeer(SECRET, domain=SETTLEMENT_DOMAIN)
    async with review_mesh(case, tmp_path) as (visual, send, _faults), visual() as app:
        assert app.state.public_routes_complete
        app.state.assistant_dispatches.peer = peer
        models = case.mesh.apps["models"]
        models.state.assistant_model_runs = AssistantModelRuns(models.state.database.sessions)
        models.state.assistant_settlement_peer = peer
        models.include_router(router)

        @models.exception_handler(ProjectResourceError)
        async def error(_request, exc):
            return JSONResponse({"code": exc.code}, status_code=exc.status)

        async with models.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            model = await db.scalar(select(ModelEntry).where(ModelEntry.slug == "vision-review"))
            model.capabilities = ["chat", "vision", "tools"]
            model_id = model.id
            await db.commit()

        response = await send("POST", SOURCE, json={"title": "Native assistant", "kind": "canvas"})
        assert response.status_code == 200, response.text
        root = SOURCE + "/" + response.json()["id"]
        created = await send("POST", root + "/conversations")
        assert created.status_code == 200, created.text
        unrelated = await send("POST", root + "/conversations")
        assert unrelated.status_code == 200, unrelated.text
        path = root + "/conversations/" + created.json()["id"]
        selected = await send("PATCH", path, json={"expected_revision": 0, "model_id": model_id})
        assert selected.status_code == 200, selected.text
        await app.state.reference_delivery.process_once()

        async def listen(frame):
            if frame["type"] != "approval_required":
                return
            if revoked:
                logout = await case.browser.post(
                    "/v1/auth/logout",
                    headers={
                        "Origin": str(case.browser.base_url).rstrip("/"),
                        "X-CSRF-Token": case.csrf,
                    },
                )
                assert logout.status_code == 204, logout.text
                return
            payload = frame["payload"]
            suffix = f"/runs/{payload['run_id']}/approvals/{payload['approval_id']}"
            wrong = root + "/conversations/" + unrelated.json()["id"] + suffix
            body = {"decision": "approve", "canvas_revision": 0}
            assert (await send("POST", wrong, json=body)).status_code == 404
            if changed:
                edit = await send(
                    "PUT",
                    root + "/canvas",
                    json={
                        "expected_revision": 0,
                        "nodes": [],
                    },
                )
                assert edit.status_code == 200, edit.text
                body["canvas_revision"] = 1
            approved = await send("POST", path + suffix, json=body)
            assert approved.status_code == 200, approved.text

        frames = await stream(
            app,
            case,
            path + "/messages/stream",
            {
                "expected_revision": selected.json()["revision"],
                "canvas_revision": 0,
                "content": "请更新画布",
            },
            listen,
        )
        assert [frame["sequence"] for frame in frames] == list(range(len(frames)))
        assert all(frame["schema_version"] == 2 for frame in frames)
        events = [frame["type"] for frame in frames]
        assert events[0] == "start"
        if revoked:
            assert events[-1] == "error"
            receipt = frames[-1]["payload"]
            assert receipt["code"] == "assistant_authority_ended"
            assert "message_state" not in receipt
            async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
                action = await db.scalar(select(VisualAssistantAction))
                assert action.status == "cancelled"
            assert calls == [0]
            return
        assert {"step", "approval_required", "approval_resolved", "delta"} <= set(events)
        canvas_frames = [item for item in frames if item["type"] == "canvas_updated"]
        assert len(canvas_frames) == 1
        assert [item["id"] for item in canvas_frames[0]["payload"]["nodes"]] == (
            [] if changed else ["from-assistant"]
        )
        assert events[-1] == "done", frames[-1]
        receipt = frames[-1]["payload"]
        assert receipt["message"]["content"] == "模型答复" and receipt["total_tokens"] == 13
        assert calls == ([0, 1, 2] if changed else [0, 1])
        canvas = await send("GET", root + "/canvas")
        assert canvas.json()["revision"] == 1
        assert [item["id"] for item in canvas.json()["nodes"]] == (
            [] if changed else ["from-assistant"]
        )
        conversation = await send("GET", path)
        history = conversation.json()["messages"][-1]
        assert history["status"] == "completed"
        assert history["actions"][0]["status"] == ("failed" if changed else "completed")
        async with models.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            log = await db.get(LlmCallLog, receipt["log_id"])
            assert log.trace_id == frames[0]["payload"]["trace_id"] and log.status == "success"
