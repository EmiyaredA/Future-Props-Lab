"""Check private assistant round streaming, idempotency and owned log settlement."""

import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.responses import JSONResponse
from sqlalchemy import select
from tests.test_community_asset_protocol import scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize
from tests.test_visual_node_review_service import review_mesh

from app.capabilities.agents.harness.contracts import ModelTextDelta, ModelTurnEnd, Usage
from app.llm.models import LlmCallLog, ModelEntry
from fpl_models.assistant_model_http import router
from fpl_models.assistant_model_runs import AssistantModelRuns
from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_assistant import MODEL_RUN_PURPOSE, SOURCE
from fpl_runtime.visual_assistant_model import (
    AssistantRound,
    AssistantRunSettle,
    AssistantRunStart,
    RunScope,
)
from fpl_visual.assistant_model_client import AssistantModelClient


async def test_visual_assistant_model_round_receipts_are_owned_and_replay_exactly(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    calls = []

    class Adapter:
        def __init__(self, *, api_key, **_):
            assert api_key == "isolated-key"

        async def stream_turn(self, **options):
            calls.append(options["round_index"])
            assert options["messages"][0].text == "Write a storyboard"
            yield ModelTextDelta("First")
            yield ModelTextDelta(" shot")
            yield ModelTurnEnd(usage=Usage(prompt_tokens=5, completion_tokens=8, total_tokens=13))

    monkeypatch.setattr("fpl_models.assistant_model_runs.decrypt_secret", lambda _: "isolated-key")
    monkeypatch.setattr("fpl_models.assistant_model_runs.HttpAgentAdapter", Adapter)
    async with review_mesh(case, tmp_path) as (visual, _send, _faults), visual() as app:
        models = case.mesh.apps["models"]
        database = models.state.database
        attempts = AssistantModelRuns(database.sessions)
        models.state.assistant_model_runs = attempts
        models.include_router(router)

        @models.exception_handler(ProjectResourceError)
        async def error(_request, exc):
            return JSONResponse({"code": exc.code}, status_code=exc.status)

        async with database.sessions(info={"owner_user_id": case.viewer}) as db:
            model_id = await db.scalar(
                select(ModelEntry.id).where(ModelEntry.slug == "vision-review")
            )
        peer = app.state.capabilities
        source = SOURCE + "/project/conversations/conversation/messages/stream"
        original = (await authorize(case, "visual", "POST", source))[HEADER]

        async def send(value):
            token = await peer.authorize_request(
                original,
                RequestGrant(
                    "visual", MODEL_RUN_PURPOSE, "POST", source, "models", "POST", value.path
                ),
            )
            return await peer.client.post(
                "http://models" + value.path,
                headers={HEADER: token},
                json=value.model_dump(mode="json"),
            )

        scope = {"project_id": "project", "conversation_id": "conversation", "run_id": str(uuid4())}
        start = AssistantRunStart(
            **scope,
            model_id=model_id,
            trace_id=str(uuid4()),
            require_vision=False,
            tools_enabled=False,
            request_summary={"message_count": 1},
        )
        first = await send(start)
        assert first.status_code == 200, first.text
        assert first.json() == {
            "id": model_id,
            "model_slug": "vision-review",
            "provider_kind": "openai",
            "tools_enabled": False,
        }
        assert (await send(start)).json() == first.json()
        assert (
            await send(start.model_copy(update={"request_summary": {"changed": True}}))
        ).status_code == 409
        with pytest.raises(CapabilityDenied):
            await send(start.model_copy(update={"project_id": "another-project"}))
        round_request = AssistantRound(
            **scope,
            index=0,
            system="System",
            messages=[{"role": "user", "text": "Write a storyboard"}],
            tools=[],
            temperature=0.7,
            max_tokens=2048,
        )
        response = await send(round_request)
        assert response.status_code == 200, response.text
        events = [json.loads(line) for line in response.text.splitlines()]
        assert [item["type"] for item in events] == ["text", "text", "turn"]
        assert events[-1]["usage"]["total_tokens"] == 13
        assert (await send(round_request)).text == response.text
        client = AssistantModelClient(peer, original, source, RunScope(**scope))
        projection = await client.begin(start)
        streamed = [
            event
            async for event in client.stream_turn(
                system=round_request.system,
                messages=round_request.messages,
                tools=[],
                model=projection.model_slug,
                temperature=round_request.temperature,
                max_tokens=round_request.max_tokens,
                round_index=0,
            )
        ]
        assert streamed == [
            ModelTextDelta("First"),
            ModelTextDelta(" shot"),
            ModelTurnEnd(usage=Usage(prompt_tokens=5, completion_tokens=8, total_tokens=13)),
        ]
        assert (
            await send(round_request.model_copy(update={"system": "Different"}))
        ).status_code == 409
        assert calls == [0]
        settle = AssistantRunSettle(
            **scope, status="completed", run_status="completed", finish_reason="stop"
        )
        closed = await send(settle)
        assert closed.status_code == 200, closed.text
        assert closed.json()["total_tokens"] == 13
        assert (await send(settle)).json() == closed.json()
        async with database.sessions(info={"owner_user_id": case.viewer}) as db:
            log = await db.get(LlmCallLog, closed.json()["log_id"])
            assert log.trace_id == start.trace_id and log.call_source == "visual_workshop_assistant"
            assert log.status == "success" and log.request_payload["message_count"] == 1

        another = {"run_id": str(uuid4())}
        assert (await send(start.model_copy(update=another))).status_code == 200

        class Unknown(Adapter):
            async def stream_turn(self, **_):
                calls.append("interrupted")
                raise asyncio.CancelledError
                yield  # pragma: no cover

        monkeypatch.setattr("fpl_models.assistant_model_runs.HttpAgentAdapter", Unknown)
        interrupted = round_request.model_copy(update=another)
        actor = SimpleNamespace(user_id=case.viewer)
        prepared = await attempts.prepare_round(actor, interrupted)
        with pytest.raises(asyncio.CancelledError):
            await anext(attempts.stream(actor, interrupted, prepared))
        await attempts.recover()
        assert (await send(interrupted)).status_code == 409
        terminal = settle.model_copy(
            update={
                **another,
                "status": "cancelled",
                "run_status": "cancelled",
                "finish_reason": "cancelled",
            }
        )
        assert (await send(terminal)).status_code == 200
        assert calls == [0, "interrupted"]
