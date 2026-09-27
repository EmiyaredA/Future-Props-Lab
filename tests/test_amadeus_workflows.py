"""Deterministic Amadeus workflow tests with isolated application data."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.console.amadeus.runs import recover_interrupted_amadeus_runs
from app.console.models.accounts import User
from app.main import app
from app.orm import bind_workspace
from app.runtime.db import SessionLocal
from db.migrations.runner import apply_migrations, check_migrations, connect_database


@pytest.fixture(autouse=True)
def desktop_amadeus(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)


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


def test_amadeus_workflow_migration_on_temporary_database(tmp_path: Path) -> None:
    database = tmp_path / "workflow.db"
    assert apply_migrations(database)[0] == "r0076_amadeus_workflows"
    assert check_migrations(database) == "r0076_amadeus_workflows"
    with connect_database(database) as connection:
        run_columns = {row[1] for row in connection.execute("PRAGMA table_info(amadeus_runs)")}
        question_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(amadeus_questions)")
        }
    assert {"mode", "source_run_id"} <= run_columns
    assert {"prompt", "status", "answer_json"} <= question_columns


@pytest.mark.asyncio
async def test_amadeus_plan_to_agent_adds_video_draft_after_restored_approval() -> None:
    """Deterministic model events; all mutations use isolated application APIs."""
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects", json={"title": "视频创作流程烟测", "kind": "video"}
            )
        ).json()
        canvas_url = f"/v1/visual-workshop/projects/{project['id']}/canvas"
        initial = (await client.get(canvas_url)).json()
        assert initial["revision"] == 0
        assert initial["nodes"] == []
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        prompt = "在当前视频项目画布新增一个日落城市镜头的视频生成草稿，先给出计划。"
        posted = await client.post(
            root + "/messages",
            json={"expected_revision": 0, "role": "user", "content": prompt},
        )
        assert posted.status_code == 200
        plan = (
            await client.post(root + "/runs", json={"model_id": "mock", "mode": "plan"})
        ).json()["run"]
        assert plan["mode"] == "plan"
        forbidden = await client.post(
            root + "/actions",
            json={
                "run_id": plan["id"],
                "tool_name": "fpl_operation:visual.apply_canvas_operations",
                "arguments": {"project_id": project["id"]},
            },
        )
        assert forbidden.status_code == 409
        forbidden_model_tool = await client.post(
            "/v1/amadeus/model-turn",
            json={
                "model_id": "mock",
                "run_id": plan["id"],
                "system": "Plan",
                "messages": [{"role": "user", "text": prompt}],
                "tools": [
                    {
                        "name": "fpl_operation:visual.apply_canvas_operations",
                        "parameters_schema": {},
                    }
                ],
            },
        )
        assert forbidden_model_tool.status_code == 422
        assert (await client.get(canvas_url)).json()["revision"] == 0
        await client.post(
            root + f"/runs/{plan['id']}/events",
            json={
                "kind": "assistant_delta",
                "payload": {"text": "先读取视频项目画布，再申请新增一张视频生成草稿卡。"},
                "idempotency_key": "plan-text",
            },
        )
        assert (
            await client.post(root + f"/runs/{plan['id']}/finish", json={"status": "completed"})
        ).status_code == 200
        agent = (
            await client.post(
                root + "/runs",
                json={"model_id": "mock", "mode": "agent", "source_run_id": plan["id"]},
            )
        ).json()["run"]
        assert agent["source_run_id"] == plan["id"]
        assert (
            await client.post(
                root + "/runs",
                json={"model_id": "mock", "mode": "agent", "source_run_id": plan["id"]},
            )
        ).status_code == 409
        await client.post(
            root + f"/runs/{agent['id']}/events",
            json={
                "kind": "tool_call",
                "payload": {
                    "tool_call_id": "read-canvas",
                    "tool_name": "fpl_read",
                    "arguments": {"path": canvas_url},
                },
                "idempotency_key": "read-call",
            },
        )
        await client.post(
            root + f"/runs/{agent['id']}/events",
            json={
                "kind": "tool_result",
                "payload": {
                    "tool_call_id": "read-canvas",
                    "name": "fpl_read",
                    "result": {"revision": 0, "nodes": []},
                },
                "idempotency_key": "read-result",
            },
        )
        node = {
            "id": "video-draft-1",
            "kind": "video",
            "title": "日落城市镜头",
            "position": {"x": 80, "y": 120},
            "generation_draft": {"prompt": "日落时分的城市街景，缓慢推进镜头"},
        }
        arguments = {
            "path_params": {"project_id": project["id"]},
            "body": {
                "expected_revision": 0,
                "request_id": "amadeus-video-draft-1",
                "operations": [
                    {"entity": "node", "action": "insert", "id": node["id"], "value": node}
                ],
            },
        }
        await client.post(
            root + f"/runs/{agent['id']}/events",
            json={
                "kind": "tool_call",
                "payload": {
                    "tool_call_id": "add-video-draft",
                    "tool_name": "fpl_operation:visual.apply_canvas_operations",
                    "arguments": arguments,
                },
                "idempotency_key": "write-call",
            },
        )
        proposed = (
            await client.post(
                root + "/actions",
                json={
                    "run_id": agent["id"],
                    "tool_name": "fpl_operation:visual.apply_canvas_operations",
                    "arguments": arguments,
                },
            )
        ).json()
        assert (await client.post(root + f"/runs/{agent['id']}/pause-approval")).json()["run"][
            "status"
        ] == "waiting_approval"
        await recover_interrupted_amadeus_runs()
        restored = (await client.get(root)).json()
        assert [item["status"] for item in restored["actions"]] == ["pending"]
        assert (await client.get(canvas_url)).json()["revision"] == 0
        assert (
            await client.post(
                root + f"/actions/{proposed['id']}/decision",
                json={"arguments_sha256": proposed["arguments_sha256"], "approve": True},
            )
        ).status_code == 200
        executed = await client.post(root + f"/actions/{proposed['id']}/execute")
        assert executed.status_code == 200, executed.text
        assert executed.json()["status"] == "completed"
        assert (await client.post(root + f"/actions/{proposed['id']}/execute")).status_code == 409
        saved = (await client.get(canvas_url)).json()
        assert saved["revision"] == 1
        assert len(saved["nodes"]) == 1
        assert saved["nodes"][0]["id"] == node["id"]
        assert saved["nodes"][0]["kind"] == "video"
        assert saved["nodes"][0]["generation_draft"]["prompt"] == node["generation_draft"]["prompt"]
        assert saved["nodes"][0]["asset_id"] is None
        stale = await client.post(
            canvas_url + "/operations",
            json={
                "expected_revision": 0,
                "request_id": "amadeus-stale-video-draft",
                "operations": [
                    {
                        "entity": "node",
                        "action": "insert",
                        "id": "stale-draft",
                        "value": {**node, "id": "stale-draft"},
                    }
                ],
            },
        )
        assert stale.status_code == 409
        assert (await client.get(canvas_url)).json()["nodes"] == saved["nodes"]
        resumed = await client.post(
            root + "/runs",
            json={"model_id": "mock", "mode": "agent", "source_run_id": agent["id"]},
        )
        assert resumed.status_code == 200
        assert resumed.json()["run"]["source_run_id"] == agent["id"]
        assert (
            await client.post(
                root + "/runs",
                json={"model_id": "mock", "mode": "agent", "source_run_id": agent["id"]},
            )
        ).status_code == 409
        await client.post(
            root + f"/runs/{resumed.json()['run']['id']}/finish", json={"status": "completed"}
        )


@pytest.mark.asyncio
async def test_amadeus_question_survives_recovery_and_answer_is_single_use() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        run = (await client.post(root + "/runs", json={"model_id": "mock", "mode": "plan"})).json()[
            "run"
        ]
        question = await client.post(
            root + f"/runs/{run['id']}/question",
            json={
                "tool_call_id": "ask-video-ratio",
                "prompt": "视频草稿采用哪种画幅？",
                "options": ["16:9", "9:16"],
                "allow_text": True,
            },
        )
        assert question.status_code == 200, question.text
        await recover_interrupted_amadeus_runs()
        pending = (await client.get(root)).json()["questions"]
        assert pending[0]["status"] == "pending"
        answered = await client.post(
            root + f"/questions/{question.json()['id']}/answer",
            json={"answer": "16:9", "note": "先保存草稿"},
        )
        assert answered.json()["answer"] == {"answer": "16:9", "note": "先保存草稿"}
        assert (
            await client.post(
                root + f"/questions/{question.json()['id']}/answer",
                json={"answer": "9:16"},
            )
        ).status_code == 409
        continuation = await client.post(
            root + "/runs",
            json={"model_id": "mock", "mode": "plan", "source_run_id": run["id"]},
        )
        assert continuation.status_code == 200, continuation.text
        await client.post(
            root + f"/runs/{continuation.json()['run']['id']}/finish",
            json={"status": "completed"},
        )


@pytest.mark.asyncio
async def test_amadeus_subagent_model_turn_rejects_write_tools() -> None:
    await _test_user()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        run = (await client.post(root + "/runs", json={"model_id": "mock"})).json()["run"]
        forbidden = await client.post(
            "/v1/amadeus/model-turn",
            json={
                "model_id": "mock",
                "run_id": run["id"],
                "subagent_id": "read-child-1",
                "system": "只读调查",
                "messages": [{"role": "user", "text": "查看项目"}],
                "tools": [
                    {
                        "name": "fpl_operation:visual.apply_canvas_operations",
                        "parameters_schema": {},
                    }
                ],
            },
        )
        assert forbidden.status_code == 422
        assert "write_tool_forbidden" in forbidden.text
        await client.post(root + f"/runs/{run['id']}/finish", json={"status": "completed"})
