"""Exercise current backend-owned CLI workflows through authenticated APIs."""

from contextlib import aclosing
from pathlib import Path

import pytest

from db.migrations.registry import LATEST_MIGRATION_ID
from db.migrations.runner import apply_migrations, check_migrations, connect_database
from studio.apps.amadeus.execution.website_runs import recover_interrupted_amadeus_runs
from tests.apps.agent_runtime.test_code_agents import configured, wait_run  # noqa: F401
from tests.apps.visual_workshop.test_workspace_governance import client_account
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


async def message(client, root, content):
    detail = (await client.get(root)).json()
    response = await client.post(
        root + "/messages",
        json={
            "expected_revision": detail["conversation"]["revision"],
            "role": "user",
            "content": content,
        },
    )
    assert response.status_code == 200, response.text


async def conversation(client):
    response = await client.post("/v1/amadeus/conversations")
    assert response.status_code == 200, response.text
    return f"/v1/amadeus/conversations/{response.json()['id']}"


async def start(client, root, **kwargs):
    response = await client.post(root + "/runs", json={"agent_id": "codex", **kwargs})
    assert response.status_code == 200, response.text
    return await wait_run(client, root, response.json()["run"]["id"])


def test_amadeus_workflow_migration_on_temporary_database(tmp_path: Path):
    database = tmp_path / "workflow.db"
    assert apply_migrations(database)[0] == LATEST_MIGRATION_ID
    assert check_migrations(database) == LATEST_MIGRATION_ID
    with connect_database(database) as connection:
        run_columns = {row[1] for row in connection.execute("PRAGMA table_info(amadeus_runs)")}
        question_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(amadeus_questions)")
        }
    assert {"mode", "source_run_id", "agent_id", "execution_config"} <= run_columns
    assert {"prompt", "status", "answer_json"} <= question_columns


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_completed_plan_and_agent_runs_accept_one_same_mode_revision():
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        root = await conversation(client)
        await message(client, root, "读取项目目录")
        for mode in ("plan", "agent"):
            original = await start(client, root, mode=mode)
            assert original["run"]["status"] == "completed"
            identity = original["run"]["id"]
            assert (
                await client.post(root + f"/runs/{identity}/finish", json={"status": "completed"})
            ).status_code == 410
            revised = await start(client, root, mode=mode, source_run_id=identity)
            assert revised["run"]["status"] == "completed"
            assert revised["run"]["source_run_id"] == identity
            duplicate = await client.post(
                root + "/runs", json={"agent_id": "codex", "mode": mode, "source_run_id": identity}
            )
            assert duplicate.status_code == 409


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_revising_write_parameters_invalidates_old_approval():
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        project = (
            await client.post(
                "/v1/visual-workshop/projects", json={"title": "审批修订", "kind": "video"}
            )
        ).json()
        canvas = f"/v1/visual-workshop/projects/{project['id']}/canvas"
        root = await conversation(client)
        await message(client, root, f"DRAFT_FAKE:{project['id']}:OLD")
        original = await start(client, root)
        assert original["run"]["status"] == "waiting_approval"
        old = (await client.get(root)).json()["actions"][0]
        rejected = await client.post(
            root + f"/actions/{old['id']}/decision",
            json={"arguments_sha256": old["arguments_sha256"], "approve": False},
        )
        assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
        assert (await client.get(canvas)).json()["revision"] == 0
        await message(client, root, f"DRAFT_FAKE:{project['id']}:NEW")
        revised = await start(client, root, source_run_id=original["run"]["id"])
        assert revised["run"]["status"] == "waiting_approval"
        current = next(
            a for a in (await client.get(root)).json()["actions"] if a["status"] == "pending"
        )
        assert current["arguments_sha256"] != old["arguments_sha256"]
        for action, digest in [(old, old["arguments_sha256"]), (current, old["arguments_sha256"])]:
            assert (
                await client.post(
                    root + f"/actions/{action['id']}/decision",
                    json={"arguments_sha256": digest, "approve": True},
                )
            ).status_code == 409
        await client.post(
            root + f"/actions/{current['id']}/decision",
            json={"arguments_sha256": current["arguments_sha256"], "approve": True},
        )
        result = await client.post(root + f"/actions/{current['id']}/execute")
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "completed"
        assert (await client.post(root + f"/actions/{current['id']}/execute")).status_code == 409
        saved = (await client.get(canvas)).json()
        assert saved["revision"] == 1 and [node["title"] for node in saved["nodes"]] == ["新标题"]


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_plan_to_agent_adds_draft_only_after_restored_approval():
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        project = (
            await client.post(
                "/v1/visual-workshop/projects", json={"title": "计划与执行", "kind": "video"}
            )
        ).json()
        canvas = f"/v1/visual-workshop/projects/{project['id']}/canvas"
        root = await conversation(client)
        await message(client, root, f"DRAFT_FAKE:{project['id']}:NEW")
        plan = await start(client, root, mode="plan")
        assert plan["run"]["status"] == "completed"
        assert any(
            e["kind"] == "tool_result" and e["payload"]["status"] == "failed"
            for e in plan["events"]
        )
        assert (await client.get(canvas)).json()["nodes"] == []
        forged = await client.post(
            root + f"/runs/{plan['run']['id']}/events",
            json={
                "kind": "assistant_delta",
                "payload": {"text": "forged"},
                "idempotency_key": "forged",
            },
        )
        assert forged.status_code == 410
        agent = await start(client, root, mode="agent", source_run_id=plan["run"]["id"])
        assert agent["run"]["status"] == "waiting_approval"
        action = (await client.get(root)).json()["actions"][0]
        await app.state.code_agent_runs.close()
        await recover_interrupted_amadeus_runs(sessions=SessionLocal)
        restored = (await client.get(root)).json()["actions"][0]
        assert (
            restored["status"] == "pending"
            and restored["arguments_sha256"] == action["arguments_sha256"]
        )
        assert (await client.get(canvas)).json()["revision"] == 0
        decision = await client.post(
            root + f"/actions/{action['id']}/decision",
            json={"approve": True, "arguments_sha256": action["arguments_sha256"]},
        )
        assert decision.status_code == 200, decision.text
        executed = await client.post(root + f"/actions/{action['id']}/execute")
        assert executed.status_code == 200 and executed.json()["status"] == "completed"
        assert (await client.post(root + f"/actions/{action['id']}/execute")).status_code == 409
        saved = (await client.get(canvas)).json()
        assert saved["revision"] == 1 and len(saved["nodes"]) == 1
        assert saved["nodes"][0]["generation_draft"]["prompt"] == "日落城市镜头"
        assert saved["nodes"][0]["asset_id"] is None


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_question_survives_recovery_and_answer_is_single_use():
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        root = await conversation(client)
        await message(client, root, "ASK_FAKE")
        original = await start(client, root, mode="plan")
        assert original["run"]["status"] == "waiting_question"
        await app.state.code_agent_runs.close()
        await recover_interrupted_amadeus_runs(sessions=SessionLocal)
        question = (await client.get(root)).json()["questions"][0]
        assert question["status"] == "pending"
        answer = await client.post(
            root + f"/questions/{question['id']}/answer", json={"answer": "A", "note": "继续读取"}
        )
        assert answer.status_code == 200 and answer.json()["answer"] == {
            "answer": "A",
            "note": "继续读取",
        }
        assert (
            await client.post(root + f"/questions/{question['id']}/answer", json={"answer": "B"})
        ).status_code == 409
        await message(client, root, "继续读取项目目录")
        result = await start(client, root, mode="plan", source_run_id=original["run"]["id"])
        assert result["run"]["status"] == "completed"


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_legacy_model_bridge_cannot_run_subagent_or_write_tools():
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        root = await conversation(client)
        await message(client, root, "读取项目目录")
        run = await start(client, root)
        for suffix in ("", "/stream"):
            response = await client.post(
                "/v1/amadeus/model-turn" + suffix,
                json={
                    "model_id": "retired",
                    "run_id": run["run"]["id"],
                    "subagent_id": "child",
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
            assert (
                response.status_code == 410 and response.json()["code"] == "external_agent_required"
            )
