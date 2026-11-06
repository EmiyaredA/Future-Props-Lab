"""The website queue preserves account isolation, ordering and recovery."""

import asyncio
import json
from contextlib import aclosing

import pytest

from studio.apps.agent_workbench.execution import runner, transcripts, turn_records
from studio.apps.agent_workbench.transport.website import execution
from studio.config.settings import CloudProject, get_settings
from tests.apps.remote_desktop.test_cloud_control import (
    WORKBENCH,
    admin_client,
    await_turn,
    configure,
    unlock,
)
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


async def test_workbench_queue_is_fifo_idempotent_and_pauses_on_stop_or_restart(
    monkeypatch,
    tmp_path,
):
    client, owner = await admin_client()
    other, other_id = await admin_client()
    configure(monkeypatch, owner, other_id)
    root = tmp_path.resolve()
    monkeypatch.setattr(
        get_settings(),
        "fpl_cloud_control_projects",
        {"project": CloudProject(label="Queue fixture", root=str(root), user_ids=[owner])},
    )
    entered = asyncio.Queue()
    gates = {}
    accepted = []

    async def resolve(*_args, **_kwargs):
        return "/fixture/cli"

    async def dialogue(
        _agent, _executable, _model, prompt, _tools, _call, emit, *, instructions, **_kwargs
    ):
        message = json.loads(prompt.split("\n", 1)[1])["message"]
        gates[message] = asyncio.Event()

        async def steer(identity, text):
            accepted.append(text)
            instructions.acknowledge(identity, "accepted")

        instructions.send = steer
        await emit("assistant_delta", {"text": "处理中"})
        await entered.put(message)
        await gates[message].wait()

    monkeypatch.setattr(execution, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "run_dialogue", dialogue)
    monkeypatch.setattr(
        app.state,
        "workbench_runs",
        runner.WorkbenchRuns(
            sessions=SessionLocal, settings=get_settings(), load_settings=get_settings
        ),
    )
    async with aclosing(client), aclosing(other):
        await unlock(client)
        result = await client.post(
            WORKBENCH + "/chats", json={"project_id": "project", "agent_id": "codex"}
        )
        assert result.status_code == 201, result.text
        path = f"{WORKBENCH}/chats/{result.json()['id']}"

        async def send(text, mode="queue"):
            response = await client.post(
                path + "/turns", json={"request_id": text, "text": text, "mode": mode}
            )
            assert response.status_code == 202, response.text
            return response.json()["id"]

        async def started(text):
            assert await asyncio.wait_for(entered.get(), 5) == text

        first = await send("first", "immediate")
        await started("first")
        async with SessionLocal() as db:
            chat_id = result.json()["id"]
            before_queue = await transcripts.latest_turn_version(db, owner, chat_id)

        second = await send("second")
        assert await send("second") == second
        removed = await send("remove me")
        third = await send("third")
        snapshot = (await client.get(path)).json()
        assert [item["id"] for item in snapshot["queue"]] == [second, removed, third]
        assert [turn["id"] for turn in snapshot["turns"]] == [first]
        assert snapshot["steerable_turn_id"] == first

        instruction = {"request_id": "insert", "text": "keep the existing tests"}
        endpoint = f"{path}/turns/{first}/instructions"
        assert (await client.post(endpoint, json=instruction)).json()["status"] == "accepted"
        assert (await client.post(endpoint, json=instruction)).json()["status"] == "accepted"
        assert accepted == [instruction["text"]]
        async with SessionLocal() as db:
            queued_version = await transcripts.latest_turn_version(db, owner, chat_id)
            assert queued_version != before_queue
            await turn_records.append_answer(db, (owner, chat_id, first), "more")
            assert await transcripts.latest_turn_version(db, owner, chat_id) != queued_version
        assert (await other.delete(f"{path}/queue/{removed}")).status_code in (403, 404)
        assert (await client.delete(f"{path}/queue/{removed}")).status_code == 204
        gates["first"].set()
        await started("second")
        assert (await client.delete(f"{path}/queue/{second}")).status_code == 409
        assert (await client.post(f"{path}/turns/{second}/stop")).status_code == 204
        snapshot = (await client.get(path)).json()
        assert snapshot["queue_paused"]
        assert [item["id"] for item in snapshot["queue"]] == [third]
        assert snapshot["turns"][-1]["status"] == "cancelled"

        async with SessionLocal() as db:
            await transcripts.interrupt_all(db, owner)
        assert (await client.post(f"{path}/queue/resume")).status_code == 204
        await started("third")
        gates["third"].set()
        await await_turn(client, path, "completed")
        assert (await client.get(path)).json()["queue"] == []
