"""Amadeus ownership, reference snapshots, approval and work-file boundaries."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app.console.amadeus.conversations import Conversations
from app.console.amadeus.files import read_file_bytes, work_root, write_file
from app.console.amadeus.model_bridge import stream_model_turn
from app.console.amadeus.runs import recover_interrupted_amadeus_runs
from app.console.amadeus.schemas import ModelTurnIn
from app.console.amadeus.scripts import run_script
from app.console.models.accounts import User
from app.llm.models import LlmCallLog, ModelEntry, ModelProvider
from app.main import app
from app.orm import bind_workspace
from app.runtime.credentials import encrypt_secret
from app.runtime.db import SessionLocal
from app.runtime.operation_receipts import OperationError


@pytest.fixture(autouse=True)
def desktop_amadeus(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)


@pytest.mark.asyncio
async def test_amadeus_routes_are_desktop_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app.state, "desktop_enabled", False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/v1/amadeus/conversations")).status_code == 404


@pytest.mark.asyncio
async def test_amadeus_model_bridge_streams_text_and_tool_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.console.amadeus import model_bridge
    from app.demo_runtime import runtime

    async def get_mock_model(*_args: object) -> tuple[SimpleNamespace, SimpleNamespace]:
        return SimpleNamespace(slug="fpl-mock"), SimpleNamespace(
            kind="openai", base_url=runtime.MOCK_BASE_URL, api_key_ciphertext=""
        )

    async def demo_configuration(_service_id: str) -> dict[str, object]:
        return {**runtime.DEFAULT_CONFIG, "enabled": True}

    class MockSession:
        async def rollback(self) -> None:
            pass

    monkeypatch.setattr(model_bridge, "get_model", get_mock_model)
    monkeypatch.setattr(model_bridge, "decrypt_secret", lambda _value: "")
    monkeypatch.setattr(runtime, "configuration", demo_configuration)
    request = ModelTurnIn(
        model_id="mock",
        run_id="run-model-log-test",
        system="回答问题",
        messages=[{"role": "user", "text": "你好"}],
        tools=[
            {
                "name": "read_context",
                "description": "读取当前上下文",
                "parameters_schema": {
                    "type": "object",
                    "properties": {"target": {"type": "string", "default": "current"}},
                },
            }
        ],
    )
    events = [
        json.loads(item) async for item in stream_model_turn(MockSession(), "default", request)
    ]
    assert events[-1]["type"] == "end"
    assert events[-1]["tool_calls"] == [
        {"id": "call_fpl_demo", "name": "read_context", "arguments": {"target": "current"}}
    ]
    assert events[-1]["usage"]["total_tokens"] == 2
    async with SessionLocal() as session:
        saved_log = await session.scalar(
            select(LlmCallLog).where(LlmCallLog.trace_id == "run-model-log-test")
        )
        assert saved_log is not None
        assert saved_log.status == "success"
        assert saved_log.total_tokens == 2

    followup = ModelTurnIn(
        model_id="mock",
        system="",
        messages=[
            {"role": "user", "text": "你好"},
            {"role": "assistant", "text": "", "tool_calls": events[-1]["tool_calls"]},
            {"role": "tool", "tool_call_id": "call_fpl_demo", "text": "已读取"},
        ],
    )
    events = [
        json.loads(item) async for item in stream_model_turn(MockSession(), "default", followup)
    ]
    assert "这是本地测试模型的确定性回复" in "".join(
        item["text"] for item in events if item["type"] == "delta"
    )
    assert events[-1]["tool_calls"] == []


@pytest.mark.asyncio
async def test_amadeus_model_bridge_settles_after_request_session_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: rollback expires ORM rows; settle must not touch them again."""
    from app.capabilities.agents.harness.contracts import ModelTextDelta, ModelTurnEnd, Usage
    from app.llm.providers import agent as agent_mod
    from sqlalchemy import delete

    async with SessionLocal() as session:
        provider = ModelProvider(
            workspace_id="default",
            name="Amadeus Bridge Probe",
            kind="openai",
            base_url="https://example.invalid/v1",
            api_key_ciphertext=encrypt_secret("probe-secret"),
            enabled=True,
        )
        session.add(provider)
        await session.flush()
        model = ModelEntry(
            workspace_id="default",
            provider_id=provider.id,
            slug="amadeus-bridge-probe",
            label="Amadeus Bridge Probe",
            capabilities=["chat", "tools"],
            enabled=True,
        )
        session.add(model)
        await session.commit()
        model_id = model.id
        provider_id = provider.id

    async def fake_turn(self, **_kwargs):  # noqa: ANN001
        del self
        yield ModelTextDelta("probe")
        yield ModelTurnEnd((), Usage(1, 1, 2))

    monkeypatch.setattr(agent_mod.HttpAgentAdapter, "stream_turn", fake_turn)

    request = ModelTurnIn(
        model_id=model_id,
        run_id="run-expire-settle-test",
        system="",
        messages=[{"role": "user", "text": "hi"}],
        tools=[],
    )
    async with SessionLocal() as session:
        events = [
            json.loads(item) async for item in stream_model_turn(session, "default", request)
        ]
    assert [event["type"] for event in events] == ["delta", "end"]
    assert events[0]["text"] == "probe"
    assert events[-1]["tool_calls"] == []
    async with SessionLocal() as session:
        saved = await session.scalar(
            select(LlmCallLog).where(LlmCallLog.trace_id == "run-expire-settle-test")
        )
        assert saved is not None
        assert saved.status == "success"
        assert saved.provider_kind == "openai"
        assert saved.model == "amadeus-bridge-probe"
        await session.execute(delete(LlmCallLog).where(LlmCallLog.id == saved.id))
        await session.execute(delete(ModelEntry).where(ModelEntry.id == model_id))
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider_id))
        await session.commit()


@pytest.mark.asyncio
async def test_amadeus_tool_api_execute_checks_revision_schema_and_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.integrations.tool_apis import catalog as tool_catalog

    class MockSession:
        async def rollback(self) -> None:
            pass

    catalog = tool_catalog.ToolApiCatalog(MockSession(), "default")
    row = SimpleNamespace(secret_ciphertext="")
    snapshot = SimpleNamespace(
        enabled=True,
        revision=2,
        parameters_schema={
            "type": "object",
            "required": ["q"],
            "properties": {"q": {"type": "string"}},
        },
        sensitive_result=False,
    )

    async def get_mock(_id: str) -> SimpleNamespace:
        return row

    async def invoke_mock(*_args: object) -> tuple[int, str, str]:
        return 200, "application/json", '{"answer":"ok"}'

    monkeypatch.setattr(catalog, "_get", get_mock)
    monkeypatch.setattr(tool_catalog, "_out", lambda _row: snapshot)
    monkeypatch.setattr(tool_catalog, "_invoke", invoke_mock)
    with pytest.raises(ValueError, match="配置已变更"):
        await catalog.execute("tool", {"q": "hello"}, 1)
    with pytest.raises(Exception, match="required property"):
        await catalog.execute("tool", {}, 2)
    assert (await catalog.execute("tool", {"q": "hello"}, 2))["text"] == '{"answer":"ok"}'

    async def invoke_failed(*_args: object) -> tuple[int, str, str]:
        return 503, "text/plain", "unavailable"

    monkeypatch.setattr(tool_catalog, "_invoke", invoke_failed)
    with pytest.raises(ValueError, match="HTTP 503"):
        await catalog.execute("tool", {"q": "hello"}, 2)


@pytest.mark.asyncio
async def test_amadeus_mcp_execute_checks_discovery_and_redacts_sensitive_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.integrations.mcp import catalog as mcp_catalog

    class MockSession:
        async def scalar(self, _query: object) -> SimpleNamespace | None:
            return SimpleNamespace(input_schema={"type": "object", "required": ["q"]})

        async def rollback(self) -> None:
            pass

    class MockClient:
        async def call(self, **_kwargs: object) -> dict[str, str]:
            return {"text": "secret response"}

    catalog = mcp_catalog.McpCatalog(MockSession(), "default", client=MockClient())
    row = SimpleNamespace(bearer_ciphertext="", environment_ciphertext="")
    snapshot = SimpleNamespace(
        enabled=True,
        revision=3,
        transport="streamable_http",
        url="https://example.invalid/mcp",
        command="",
        arguments=[],
        sensitive_result=True,
    )

    async def get_mock(_id: str) -> SimpleNamespace:
        return row

    async def out_mock(_row: object) -> SimpleNamespace:
        return snapshot

    monkeypatch.setattr(catalog, "_get", get_mock)
    monkeypatch.setattr(catalog, "_out", out_mock)
    with pytest.raises(ValueError, match="配置已变更"):
        await catalog.execute("server", "search", {"q": "hello"}, 2)
    with pytest.raises(Exception, match="required property"):
        await catalog.execute("server", "search", {}, 3)
    assert (await catalog.execute("server", "search", {"q": "hello"}, 3)) == {
        "result": "敏感结果已隐藏"
    }


@pytest.mark.asyncio
async def test_amadeus_registered_fpl_operations_read_and_approved_write() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        catalog = await client.get("/v1/amadeus/operations", params={"resource": "video"})
        assert catalog.status_code == 200, catalog.text
        operations = catalog.json()["items"]
        assert any(item["id"] == "video.list_projects" for item in operations)
        assert any(item["id"] == "video.create_project" for item in operations)

        listed = await client.post(
            "/v1/amadeus/operations/read",
            json={"operation": "video.list_projects", "arguments": {}},
        )
        assert listed.status_code == 200, listed.text
        assert listed.json()["status_code"] == 200
        denied = await client.post(
            "/v1/amadeus/operations/read",
            json={"operation": "video.create_project", "arguments": {"body": {"title": "no"}}},
        )
        assert denied.status_code == 422

        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        proposed = (
            await client.post(
                root + "/actions",
                json={
                    "tool_name": "fpl_operation:video.create_project",
                    "arguments": {"body": {"title": "Amadeus API 项目"}},
                },
            )
        ).json()
        assert (await client.post(root + f"/actions/{proposed['id']}/execute")).status_code == 409
        approved = await client.post(
            root + f"/actions/{proposed['id']}/decision",
            json={"arguments_sha256": proposed["arguments_sha256"], "approve": True},
        )
        assert approved.status_code == 200
        outcome = await client.post(root + f"/actions/{proposed['id']}/execute")
        assert outcome.status_code == 200, outcome.text
        assert outcome.json()["status"] == "completed"
        assert outcome.json()["result"]["result"]["title"] == "Amadeus API 项目"

        visual = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "Amadeus 视觉项目", "kind": "image"},
            )
        ).json()
        visual_read = await client.post(
            "/v1/amadeus/operations/read",
            json={
                "operation": "visual.get_project",
                "arguments": {"path_params": {"project_id": visual["id"]}},
            },
        )
        assert visual_read.status_code == 200
        assert visual_read.json()["result"]["revision"] == 0
        malformed_action = (
            await client.post(
                root + "/actions",
                json={
                    "tool_name": "fpl_operation:visual.apply_canvas_operations",
                    "arguments": {
                        "path_params": {"project_id": visual["id"]},
                        "body": (
                            '{"expected_revision": 0, "request_id": "json-string", '
                            '"operations": []}'
                        ),
                    },
                },
            )
        ).json()
        assert (
            await client.post(
                root + f"/actions/{malformed_action['id']}/decision",
                json={
                    "arguments_sha256": malformed_action["arguments_sha256"],
                    "approve": True,
                },
            )
        ).status_code == 200
        rejected = await client.post(root + f"/actions/{malformed_action['id']}/execute")
        assert rejected.status_code == 200, rejected.text
        assert rejected.json()["status"] == "failed"
        assert rejected.json()["result"]["code"] == "validation_error"
        assert "body:" in rejected.json()["result"]["message"]
        visual_action = (
            await client.post(
                root + "/actions",
                json={
                    "tool_name": "fpl_operation:visual.patch_project",
                    "arguments": {
                        "path_params": {"project_id": visual["id"]},
                        "body": {
                            "expected_revision": 0,
                            "title": "Amadeus 视觉项目 v2",
                        },
                    },
                },
            )
        ).json()
        assert (
            await client.post(
                root + f"/actions/{visual_action['id']}/decision",
                json={
                    "arguments_sha256": visual_action["arguments_sha256"],
                    "approve": True,
                },
            )
        ).status_code == 200
        visual_updated = await client.post(root + f"/actions/{visual_action['id']}/execute")
        assert visual_updated.status_code == 200, visual_updated.text
        assert visual_updated.json()["status"] == "completed", visual_updated.text
        assert visual_updated.json()["result"]["result"]["revision"] == 1


@pytest.mark.asyncio
async def test_amadeus_skill_keeps_loaded_version(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from app.console.amadeus import skills

    source = tmp_path / "source"
    for version in ("v1", "v2"):
        folder = source / version
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(version)
    state = {"default": "v1"}

    class Catalog:
        def __init__(self, *_args: object) -> None:
            self.storage = SimpleNamespace(final_path=lambda _id, version: source / version)

        async def get(self, _id: str) -> SimpleNamespace:
            return SimpleNamespace(
                enabled=True, default_version=state["default"], latest_version="v2", name="测试技能"
            )

        async def versions(self, _id: str) -> list[SimpleNamespace]:
            return [SimpleNamespace(version="v1"), SimpleNamespace(version="v2")]

    class Session:
        async def rollback(self) -> None:
            pass

    monkeypatch.setattr(skills, "SkillCatalog", Catalog)
    monkeypatch.setattr(skills, "work_root", lambda *_args: tmp_path / "session")
    first = await skills.load_skill(Session(), "default", "conversation", "skill")
    state["default"] = "v2"
    again = await skills.load_skill(Session(), "default", "conversation", "skill")
    assert (first["version"], first["content"]) == ("v1", "v1")
    assert (again["version"], again["content"]) == ("v1", "v1")
    (tmp_path / "session" / "skills" / "skill" / "v1" / "guide.txt").write_text("固定版本附属文件")
    resource = skills.read_skill_file("default", "conversation", "skill", "v1", "guide.txt")
    assert resource["content"] == "固定版本附属文件"
    with pytest.raises(OperationError, match="路径无效"):
        skills.read_skill_file("default", "conversation", "skill", "v1", "../v2/SKILL.md")


@pytest.mark.asyncio
async def test_amadeus_cancel_marks_external_result_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.integrations.tool_apis.catalog import ToolApiCatalog

    await _test_user()
    started = asyncio.Event()

    async def slow_execute(*_args: object) -> dict[str, object]:
        started.set()
        await asyncio.Event().wait()
        return {}

    monkeypatch.setattr(ToolApiCatalog, "execute", slow_execute)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
        root = f"/v1/amadeus/conversations/{conversation_id}"
        action = (
            await client.post(
                root + "/actions",
                json={
                    "tool_name": "tool_api:dummy",
                    "arguments": {"input": {}, "revision": 0},
                },
            )
        ).json()
        await client.post(
            root + f"/actions/{action['id']}/decision",
            json={
                "arguments_sha256": action["arguments_sha256"],
                "approve": True,
            },
        )
        executing = asyncio.create_task(client.post(root + f"/actions/{action['id']}/execute"))
        await asyncio.wait_for(started.wait(), timeout=5)
        cancelled = await client.post(root + f"/actions/{action['id']}/cancel")
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "unknown"
        with pytest.raises(asyncio.CancelledError):
            await executing
        detail = (await client.get(root)).json()
        assert detail["actions"][0]["status"] == "unknown"


@pytest.mark.asyncio
async def test_amadeus_script_execution_streams_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.console.amadeus import actions

    await _test_user()

    async def fake_script(
        _workspace_id: str,
        _conversation_id: str,
        _arguments: dict,
        on_output=None,
    ) -> dict[str, object]:
        on_output("第一步\n")
        await asyncio.sleep(0)
        on_output("第二步\n")
        return {"exit_code": 0, "output": "第一步\n第二步\n", "truncated": False}

    monkeypatch.setattr(actions, "run_script", fake_script)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
        root = f"/v1/amadeus/conversations/{conversation_id}"
        action = (
            await client.post(
                root + "/actions",
                json={
                    "tool_name": "run_script",
                    "arguments": {"kind": "python", "name": "a.py"},
                },
            )
        ).json()
        await client.post(
            root + f"/actions/{action['id']}/decision",
            json={
                "arguments_sha256": action["arguments_sha256"],
                "approve": True,
            },
        )
        response = await client.post(root + f"/actions/{action['id']}/execute/stream")
        assert response.status_code == 200
        events = [json.loads(line) for line in response.text.splitlines()]
        assert [event["text"] for event in events if event["type"] == "output"] == [
            "第一步\n",
            "第二步\n",
        ]
        assert events[-1]["type"] == "end"
        assert events[-1]["action"]["status"] == "completed"


@pytest.mark.asyncio
async def test_amadeus_read_only_principal_cannot_execute_approved_write() -> None:
    from app.console.amadeus.actions import execute_action

    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
        root = f"/v1/amadeus/conversations/{conversation_id}"
        action = (
            await client.post(
                root + "/actions",
                json={
                    "tool_name": "write_script",
                    "arguments": {"name": "safe.py", "content": "pass"},
                },
            )
        ).json()
        await client.post(
            root + f"/actions/{action['id']}/decision",
            json={
                "arguments_sha256": action["arguments_sha256"],
                "approve": True,
            },
        )
    principal = SimpleNamespace(
        user_id="test-user", workspace_id="default", allows=lambda _capability: False
    )
    async with SessionLocal() as session:
        bind_workspace(session, "default")
        with pytest.raises(OperationError) as error:
            await execute_action(session, principal, conversation_id, action["id"], None)
        assert error.value.status == 403


async def _test_user() -> None:
    async with SessionLocal() as session:
        bind_workspace(session, "default")
        if await session.get(User, "test-user") is None:
            session.add(
                User(
                    id="test-user",
                    username="amadeus-test",
                    username_normalized="amadeus-test",
                    password_hash="not-a-login",
                )
            )
            await session.commit()


@pytest.mark.asyncio
async def test_amadeus_conversation_references_cas_and_owner() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post("/v1/amadeus/conversations")
        assert created.status_code == 200, created.text
        conversation = created.json()
        reference = {
            "id": "clip-1",
            "application": "视频剪辑工坊",
            "name": "城市开场片段",
            "value": "80%",
            "source": "/video-editor/project-1",
        }
        body = {
            "expected_revision": conversation["revision"],
            "role": "user",
            "content": "让这段开场柔和一点",
            "references": [reference],
        }
        saved = await client.post(
            f"/v1/amadeus/conversations/{conversation['id']}/messages", json=body
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["messages"][0]["references"][0]["name"] == "城市开场片段"
        stale = await client.post(
            f"/v1/amadeus/conversations/{conversation['id']}/messages", json=body
        )
        assert stale.status_code == 409
        detail = await client.get(f"/v1/amadeus/conversations/{conversation['id']}")
        assert detail.json()["messages"][0]["references"][0]["value"] == "80%"
    async with SessionLocal() as session:
        bind_workspace(session, "default")
        other = SimpleNamespace(user_id="someone-else", workspace_id="default")
        with pytest.raises(OperationError) as exc:
            await Conversations(session, other).detail(conversation["id"])
        assert exc.value.status == 404
        other_workspace = SimpleNamespace(user_id="test-user", workspace_id="another")
        with pytest.raises(OperationError) as exc:
            await Conversations(session, other_workspace).detail(conversation["id"])
        assert exc.value.status == 404


@pytest.mark.asyncio
async def test_amadeus_concurrent_message_cas_allows_one_writer() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        path = f"/v1/amadeus/conversations/{conversation['id']}/messages"
        results = await asyncio.gather(
            client.post(path, json={"expected_revision": 0, "role": "user", "content": "第一条"}),
            client.post(path, json={"expected_revision": 0, "role": "user", "content": "第二条"}),
        )
        assert sorted(response.status_code for response in results) == [200, 409]
        detail = (await client.get(f"/v1/amadeus/conversations/{conversation['id']}")).json()
        assert detail["conversation"]["revision"] == 1
        assert len(detail["messages"]) == 1


@pytest.mark.asyncio
async def test_amadeus_run_is_single_idempotent_and_persists_partial_reply() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        run_response = await client.post(
            root + "/runs",
            json={
                "model_id": "mock",
                "context": [{"application": "视频剪辑工坊", "projectId": "project-1"}],
                "references": [],
                "capabilities": ["fpl_operations"],
            },
        )
        assert run_response.status_code == 200, run_response.text
        run = run_response.json()["run"]
        duplicate = await client.post(
            root + "/runs",
            json={"model_id": "mock", "context": [], "references": [], "capabilities": []},
        )
        assert duplicate.status_code == 409
        event_path = root + f"/runs/{run['id']}/events"
        event_body = {
            "kind": "assistant_delta",
            "payload": {"text": "正在分析片段"},
            "idempotency_key": "delta-1",
        }
        first = await client.post(event_path, json=event_body)
        repeated = await client.post(event_path, json=event_body)
        assert first.status_code == repeated.status_code == 200
        assert first.json()["id"] == repeated.json()["id"]
        history = await client.get(root + "/runs")
        assert history.status_code == 200
        assert history.json()[0]["events"][0]["payload"] == {"text": "正在分析片段"}
        action = (
            await client.post(
                root + "/actions",
                json={
                    "run_id": run["id"],
                    "tool_name": "write_script",
                    "arguments": {"name": "late.py", "content": "print('late')"},
                },
            )
        ).json()
        cancelling = await client.post(root + f"/runs/{run['id']}/cancel")
        assert cancelling.status_code == 200
        assert cancelling.json()["run"]["status"] == "cancelling"
        trailing = await client.post(
            root + f"/runs/{run['id']}/events",
            json={
                "kind": "assistant_delta",
                "payload": {"text": "，以及停止前的尾部"},
                "idempotency_key": "partial-after-cancel",
            },
        )
        assert trailing.status_code == 200
        finished = await client.post(
            root + f"/runs/{run['id']}/finish",
            json={"status": "cancelled", "error_message": "用户停止"},
        )
        assert finished.status_code == 200, finished.text
        assert finished.json()["run"]["status"] == "cancelled"
        repeated_finish = await client.post(
            root + f"/runs/{run['id']}/finish",
            json={"status": "failed", "error_message": "迟到的重复终态"},
        )
        assert repeated_finish.status_code == 200
        assert repeated_finish.json()["run"]["status"] == "cancelled"
        detail = (await client.get(root)).json()
        reply = detail["messages"][-1]
        assert reply["content"] == "正在分析片段，以及停止前的尾部"
        assert reply["run_id"] == run["id"]
        assert reply["status"] == "cancelled"
        expired = await client.post(
            root + f"/actions/{action['id']}/decision",
            json={"arguments_sha256": action["arguments_sha256"], "approve": True},
        )
        assert expired.status_code == 409
        assert (await client.get("/v1/amadeus/runs/active")).json() is None


@pytest.mark.asyncio
async def test_amadeus_startup_recovery_interrupts_run_without_replay() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        run = (
            await client.post(
                root + "/runs",
                json={"model_id": "mock", "context": [], "references": [], "capabilities": []},
            )
        ).json()["run"]
        await client.post(
            root + f"/runs/{run['id']}/events",
            json={
                "kind": "assistant_delta",
                "payload": {"text": "已收到部分回复"},
                "idempotency_key": "partial-1",
            },
        )
        action = (
            await client.post(
                root + "/actions",
                json={"run_id": run["id"], "tool_name": "write_script", "arguments": {}},
            )
        ).json()
        await recover_interrupted_amadeus_runs()
        recovered = (await client.get(root + f"/runs/{run['id']}")).json()
        assert recovered["run"]["status"] == "interrupted"
        assert recovered["run"]["partial_text"] == "已收到部分回复"
        detail = (await client.get(root)).json()
        assert detail["messages"][-1]["status"] == "interrupted"
        saved_action = next(item for item in detail["actions"] if item["id"] == action["id"])
        assert saved_action["status"] == "cancelled"


@pytest.mark.asyncio
async def test_amadeus_approval_binds_arguments_and_runs_once() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        proposed = await client.post(
            root + "/actions",
            json={
                "tool_name": "write_script",
                "arguments": {"name": "hello.py", "content": "print('hello')"},
            },
        )
        assert proposed.status_code == 200, proposed.text
        action = proposed.json()
        denied_hash = await client.post(
            root + f"/actions/{action['id']}/decision",
            json={"arguments_sha256": "0" * 64, "approve": True},
        )
        assert denied_hash.status_code == 409
        approved = await client.post(
            root + f"/actions/{action['id']}/decision",
            json={"arguments_sha256": action["arguments_sha256"], "approve": True},
        )
        assert approved.json()["status"] == "approved"
        completed = await client.post(root + f"/actions/{action['id']}/execute")
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed"
        saved = read_file_bytes("default", conversation["id"], "scripts", "hello.py")
        assert saved == b"print('hello')"
        again = await client.post(root + f"/actions/{action['id']}/execute")
        assert again.status_code == 409


@pytest.mark.asyncio
async def test_amadeus_files_reject_traversal_symlinks_and_stale_writes(tmp_path: Path) -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
    with pytest.raises(OperationError):
        write_file("default", conversation_id, "imports", "../outside", b"bad", "")
    item = write_file("default", conversation_id, "imports", "safe.txt", b"first", "")
    assert item["sha256"] == hashlib.sha256(b"first").hexdigest()
    with pytest.raises(OperationError) as conflict:
        write_file("default", conversation_id, "imports", "safe.txt", b"second", "")
    assert conflict.value.status == 409
    outside = tmp_path / "secret.txt"
    outside.write_text("private")
    link = work_root("default", conversation_id) / "imports" / "link.txt"
    os.symlink(outside, link)
    with pytest.raises(OperationError):
        read_file_bytes("default", conversation_id, "imports", "link.txt")
    with pytest.raises(OperationError):
        write_file("default", conversation_id, "imports", "link.txt", b"bad", "")
    assert outside.read_text() == "private"


@pytest.mark.asyncio
async def test_amadeus_video_batch_applies_once_and_reports_revision_conflict() -> None:
    await _test_user()
    clip = {
        "id": "amadeus-opening",
        "trackId": "visual-1",
        "kind": "color",
        "name": "城市开场片段",
        "timelineStartUs": 0,
        "durationUs": 2_000_000,
        "sourceInUs": 0,
        "color": "#333333",
        "fontSize": 72,
        "textColor": "#ffffff",
        "volume": 1,
        "transform": {
            "x": 960,
            "y": 540,
            "scaleX": 1,
            "scaleY": 1,
            "rotation": 0,
            "opacity": 1,
        },
        "keyframes": [],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project_response = await client.post(
            "/v1/video-editor/projects", json={"title": "Amadeus 剪辑"}
        )
        project = project_response.json()
        project_id = project["id"]
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
        root = f"/v1/amadeus/conversations/{conversation_id}"

        async def execute(arguments: dict) -> dict:
            run = (
                await client.post(
                    root + "/runs",
                    json={
                        "model_id": "mock",
                        "context": [
                            {
                                "application": "视频剪辑工坊",
                                "projectId": project_id,
                            }
                        ],
                        "references": [],
                        "capabilities": ["video_timeline_batch"],
                    },
                )
            ).json()["run"]
            proposed = (
                await client.post(
                    root + "/actions",
                    json={
                        "run_id": run["id"],
                        "tool_name": "video_timeline_batch",
                        "arguments": arguments,
                    },
                )
            ).json()
            approved = await client.post(
                root + f"/actions/{proposed['id']}/decision",
                json={
                    "arguments_sha256": proposed["arguments_sha256"],
                    "approve": True,
                },
            )
            assert approved.status_code == 200
            completed = await client.post(root + f"/actions/{proposed['id']}/execute")
            assert completed.status_code == 200, completed.text
            await client.post(
                root + f"/runs/{run['id']}/finish",
                json={"status": "completed"},
            )
            return completed.json()

        applied = await execute(
            {
                "project_id": project_id,
                "expected_revision": 0,
                "operations": [{"type": "addClip", "clip": clip}],
            }
        )
        assert applied["status"] == "completed"
        assert applied["result"]["operationResults"] == [
            {"index": 1, "type": "addClip", "status": "completed"}
        ]
        timeline_url = f"/v1/video-editor/projects/{project_id}/timeline"
        assert (await client.get(timeline_url)).json()["revision"] == 1

        stale = await execute(
            {
                "project_id": project_id,
                "expected_revision": 0,
                "operations": [
                    {"type": "updateClip", "clipId": clip["id"], "patch": {"name": "不应覆盖"}}
                ],
            }
        )
        assert stale["status"] == "failed"
        assert stale["result"]["code"] == "revision_conflict"
        assert stale["result"]["operationResults"] == [
            {"index": 1, "type": "updateClip", "status": "not_executed"}
        ]
        timeline = (await client.get(timeline_url)).json()
        assert timeline["revision"] == 1
        assert timeline["document"]["tracks"][0]["clips"][0]["name"] == "城市开场片段"


@pytest.mark.asyncio
@pytest.mark.parametrize("packaged", [False, True])
async def test_amadeus_script_sandbox_reads_only_conversation_files(
    monkeypatch: pytest.MonkeyPatch, packaged: bool
) -> None:
    if sys.platform != "darwin" or not Path("/usr/bin/sandbox-exec").is_file():
        pytest.skip("macOS system sandbox unavailable")
    probe = subprocess.run(
        ["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"],
        capture_output=True,
        check=False,
    )
    if probe.returncode:
        pytest.skip("host process forbids sandbox-exec")
    if packaged:
        runner = Path("desktop/build/runner/fpl-script-runner/fpl-script-runner").resolve()
        if not runner.is_file():
            pytest.skip("packaged runner not built")
        from app.console.amadeus import scripts

        monkeypatch.setattr(scripts, "_runner", lambda: (runner, [], runner.parent))
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
        other_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
    other = work_root("default", other_id) / "imports" / "private.txt"
    other.parent.mkdir(parents=True)
    other.write_text("private")
    script = (
        "from pathlib import Path\n"
        "import json, csv, sqlite3\n"
        "print('sandbox-ok')\n"
        "try:\n"
        f"    Path({str(other)!r}).read_text()\n"
        "    print('outside-readable')\n"
        "except OSError:\n"
        "    print('outside-denied')\n"
        "import socket, subprocess\n"
        "try:\n"
        "    socket.socket().connect(('127.0.0.1', 9))\n"
        "    print('network-open')\n"
        "except PermissionError:\n"
        "    print('network-denied')\n"
        "except OSError:\n"
        "    print('network-other')\n"
        "try:\n"
        "    subprocess.run(['/bin/echo', 'outside-process'], check=True)\n"
        "except PermissionError:\n"
        "    print('process-denied')\n"
        "Path('outputs/result.txt').write_text('done')\n"
    ).encode()
    work_root("default", conversation_id).joinpath("outputs").mkdir(parents=True)
    write_file("default", conversation_id, "scripts", "check.py", script, "")
    result = await run_script(
        "default",
        conversation_id,
        {
            "kind": "python",
            "name": "check.py",
            "sha256": hashlib.sha256(script).hexdigest(),
        },
    )
    assert result["exit_code"] == 0, result["output"]
    assert "sandbox-ok" in result["output"]
    assert "outside-denied" in result["output"]
    assert "outside-readable" not in result["output"]
    assert "network-denied" in result["output"]
    assert "process-denied" in result["output"]
    assert read_file_bytes("default", conversation_id, "outputs", "result.txt") == b"done"


@pytest.mark.asyncio
async def test_amadeus_script_timeout_terminates_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if sys.platform != "darwin" or not Path("/usr/bin/sandbox-exec").is_file():
        pytest.skip("macOS system sandbox unavailable")
    probe = subprocess.run(
        ["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"],
        capture_output=True,
        check=False,
    )
    if probe.returncode:
        pytest.skip("host process forbids sandbox-exec")
    from app.console.amadeus import scripts

    monkeypatch.setattr(scripts, "SCRIPT_TIMEOUT_SECONDS", 0.2)
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation_id = (await client.post("/v1/amadeus/conversations")).json()["id"]
    script = b"import time\ntime.sleep(10)\n"
    write_file("default", conversation_id, "scripts", "slow.py", script, "")
    with pytest.raises(TimeoutError):
        await run_script(
            "default",
            conversation_id,
            {"kind": "python", "name": "slow.py", "sha256": hashlib.sha256(script).hexdigest()},
        )
