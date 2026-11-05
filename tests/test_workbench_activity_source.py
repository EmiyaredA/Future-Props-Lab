"""Managed source preview is tied to successful operations and current authorization."""

from contextlib import aclosing
from types import SimpleNamespace

import pytest

from studio.apps.agent_workbench.execution import runner
from studio.apps.agent_workbench.transport.website import execution
from studio.apps.identity.storage import cloud_access as access
from studio.config.settings import CloudProject, get_settings
from test_cloud_control import WORKBENCH, admin_client, await_turn, configure, enroll
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


async def test_managed_source_preview_rechecks_scope_and_filesystem(monkeypatch, tmp_path):
    client, owner = await admin_client()
    other, other_owner = await admin_client()
    configure(monkeypatch, owner, other_owner)
    root = (tmp_path / "project").resolve()
    root.mkdir()
    file = root / "sample.py"
    file.write_text("print('fixture')\n")
    monkeypatch.setattr(
        get_settings(),
        "fpl_cloud_control_projects",
        {"fixture": CloudProject(label="Fixture", root=str(root), user_ids=[owner])},
    )

    async def resolve(*_args, **_kwargs):
        return "/fixture/cli"

    async def dialogue(_kind, _executable, _model, _prompt, _tools, call, emit, **_kwargs):
        await emit("assistant_delta", {"text": "先读取文件。"})
        for identity, name, args in (
            ("read", "read_file", {"path": "sample.py", "line": 1}),
            ("outside", "read_file", {"path": "../outside.py"}),
            ("write", "write_file", {"path": "sample.py", "content": "print('revised')\n"}),
        ):
            await emit(
                "tool_call", {"tool_call_id": identity, "tool_name": name, "arguments": args}
            )
            try:
                result = await call(name, args)
            except ValueError:
                await emit("tool_result", {"tool_call_id": identity, "status": "failed"})
            else:
                await emit(
                    "tool_result",
                    {"tool_call_id": identity, "status": "completed", "result": result},
                )
        await emit("assistant_delta", {"text": "已完成。"})

    monkeypatch.setattr(execution, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "run_dialogue", dialogue)
    monkeypatch.setattr(
        app.state,
        "workbench_runs",
        runner.WorkbenchRuns(sessions=SessionLocal, settings=get_settings()),
    )
    async with aclosing(client), aclosing(other):
        await enroll(client)
        await enroll(other)
        response = await client.post(
            WORKBENCH + "/chats", json={"project_id": "fixture", "agent_id": "codex"}
        )
        assert response.status_code == 201, response.text
        chat = WORKBENCH + "/chats/" + response.json()["id"]
        response = await client.post(
            chat + "/turns", json={"request_id": "read", "text": "查看源码"}
        )
        assert response.status_code == 202, response.text
        turn = chat + "/turns/" + response.json()["id"]
        pending = await await_turn(client, chat, "waiting_approval")
        preview = turn + "/source"
        assert (await client.get(preview, params={"call_id": "write"})).status_code == 404
        assert (await client.get(preview, params={"call_id": "outside"})).status_code == 404
        assert (await other.get(preview, params={"call_id": "read"})).status_code == 404
        source = await client.get(preview, params={"call_id": "read"})
        assert source.status_code == 200 and source.headers["cache-control"] == "no-store"
        assert source.json() == {
            "path": "sample.py",
            "text": "print('fixture')\n",
            "line": 1,
            "diff": None,
        }
        approval = pending["approvals"][0]
        assert (
            await client.post(turn + "/approvals/" + approval["id"], json={"approved": True})
        ).status_code == 204
        completed = await await_turn(client, chat, "completed")
        assert [row["source_available"] for row in completed["activity"]] == [True, False, True]
        assert completed["activity"][2]["sequence"] < completed["approvals"][0]["sequence"]
        source = await client.get(preview, params={"call_id": "write"})
        assert "+print('revised')" in source.json()["diff"]
        assert source.json()["text"] == "print('revised')\n"

        target = tmp_path / "outside.py"
        target.write_text("private")
        file.unlink()
        assert (await client.get(preview, params={"call_id": "read"})).status_code == 404
        file.symlink_to(target)
        assert (await client.get(preview, params={"call_id": "read"})).status_code == 404
        now = access.time.time()
        monkeypatch.setattr(access, "time", SimpleNamespace(time=lambda: now + 3600))
        assert (await client.get(preview, params={"call_id": "read"})).status_code == 403
