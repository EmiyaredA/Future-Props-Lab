"""Exercise durable assistant source preparation and settlement without stored user tokens."""

import json
from uuid import uuid4

from fastapi.responses import JSONResponse
from sqlalchemy import select
from tests.test_community_asset_protocol import scenario  # noqa: F401
from tests.test_visual_node_review_service import review_mesh

from app.llm.models import LlmCallLog
from fpl_models.assistant_model_http import router
from fpl_models.assistant_model_runs import AssistantModelRuns
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.timed_peer import TimedPeer
from fpl_runtime.visual_assistant import SOURCE
from fpl_runtime.visual_assistant_model import SETTLEMENT_DOMAIN, RecoveredAssistantSettlement
from fpl_visual.assistant_dispatch_records import VisualAssistantDispatch
from fpl_visual.assistant_stream import AssistantStream

SECRET = "isolated-assistant-settlement-credential-" * 2


async def test_assistant_source_and_model_settlement_recover_without_persisting_actor_tokens(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    peer = TimedPeer(SECRET, domain=SETTLEMENT_DOMAIN)
    async with review_mesh(case, tmp_path) as (visual, send, _faults):
        models = case.mesh.apps["models"]
        models.state.assistant_model_runs = AssistantModelRuns(models.state.database.sessions)
        models.state.assistant_settlement_peer = peer
        models.include_router(router)

        @models.exception_handler(ProjectResourceError)
        async def error(_request, exc):
            return JSONResponse({"code": exc.code}, status_code=exc.status)

        async with visual() as app:
            dispatches = app.state.assistant_dispatches
            dispatches.peer = peer

            async def interrupted_events(stream):
                turn = stream.turn
                yield json.dumps(
                    {
                        "run_id": turn.scope.run_id,
                        "message_id": turn.message_id,
                        "revision": turn.revision,
                        "provider_message": turn.messages[-1].text,
                    }
                ).encode()

            monkeypatch.setattr(AssistantStream, "events", interrupted_events)

            project = await send("POST", SOURCE, json={"title": "Assistant", "kind": "canvas"})
            assert project.status_code == 200, project.text
            project_id = project.json()["id"]
            root = f"{SOURCE}/{project_id}"
            await app.state.reference_delivery.process_once()
            asset = await send(
                "POST",
                "/v1/files",
                service="assets",
                data={"project_id": project_id},
                files={"upload": ("notes.md", "镜头资料".encode(), "text/markdown")},
            )
            assert asset.status_code == 200, asset.text
            asset_id = asset.json()["id"]
            saved = await send("POST", root + "/conversations")
            assert saved.status_code == 200, saved.text
            path = root + "/conversations/" + saved.json()["id"]
            await app.state.reference_delivery.process_once()
            request = {
                "expected_revision": saved.json()["revision"],
                "canvas_revision": 0,
                "content_parts": [
                    {"type": "text", "text": "给出建议 "},
                    {"type": "asset", "asset_id": asset_id},
                ],
            }
            launched = await send("POST", path + "/messages/stream", json=request)
            assert launched.status_code == 200, launched.text
            turn = launched.json()
            assert (
                "镜头资料" in turn["provider_message"] and "不可信数据" in turn["provider_message"]
            )
            stale = await send("POST", path + "/messages/stream", json=request)
            assert stale.status_code == 409, stale.text
            await app.state.reference_delivery.process_once()
            current = await send("GET", path)
            assert current.status_code == 200, current.text
            assert current.json()["messages"][-1]["status"] == "pending"
            assert current.json()["messages"][0]["assets"][0]["id"] == asset_id
            columns = VisualAssistantDispatch.__table__.columns.keys()
            assert "assertion" not in columns and "source_path" not in columns
            async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
                dispatch = await db.get(VisualAssistantDispatch, turn["run_id"])
                assert dispatch.phase == "streaming"
                trace_id = dispatch.trace_id

        async with visual() as restarted:
            dispatches = restarted.state.assistant_dispatches
            dispatches.peer = peer
            await dispatches.recover()
            current = await send("GET", path)
            assert current.json()["messages"][-1]["status"] == "cancelled"
            async with restarted.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
                dispatch = await db.get(VisualAssistantDispatch, turn["run_id"])
                assert dispatch.phase == "settling"
                encoded = json.dumps(dispatch.settlement)
                assert "assertion" not in encoded
                command = RecoveredAssistantSettlement.model_validate(dispatch.settlement)
            client = restarted.state.capabilities.client
            denied = await client.post("http://models" + command.path, json=command.model_dump())
            assert denied.status_code == 401
            wrong = command.model_copy(update={"trace_id": str(uuid4())})
            denied = await client.post(
                "http://models" + wrong.path,
                headers=peer.headers("POST", wrong.path, case.viewer),
                json=wrong.model_dump(mode="json"),
            )
            assert denied.status_code == 404
            logout = await case.browser.post(
                "/v1/auth/logout",
                headers={
                    "Origin": str(case.browser.base_url).rstrip("/"),
                    "X-CSRF-Token": case.csrf,
                },
            )
            assert logout.status_code in (200, 204), logout.text
            await dispatches.process_once()
            async with models.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
                logs = list(
                    await db.scalars(select(LlmCallLog).where(LlmCallLog.trace_id == trace_id))
                )
                assert len(logs) == 1 and logs[0].auth_kind == "session"
                assert logs[0].response_payload["status"] == "cancelled"
