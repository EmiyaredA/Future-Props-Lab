import asyncio
import sqlite3

import httpx
import pytest
from fastapi import FastAPI

from studio.host.deployment.agent_cutover import CutoverDeferred, cutover
from studio.runtime.http.agent_admission import AgentAdmission, admission_status


@pytest.fixture
def installation(tmp_path):
    (tmp_path / "inflight").mkdir()
    databases = {key: tmp_path / (key + ".db") for key in ("amadeus", "agent-runtime")}
    tables = (
        ("amadeus_runs", "amadeus_actions", "amadeus_questions", "amadeus_native_jobs"),
        ("agent_runtime_connection_jobs", "agent_runtime_visual_review_jobs"),
    )
    for path, owned_tables in zip(databases.values(), tables, strict=True):
        with sqlite3.connect(path) as connection:
            for table in owned_tables:
                connection.execute(f"CREATE TABLE {table} (status TEXT NOT NULL)")
    return tmp_path, databases


@pytest.mark.parametrize(
    ("table", "status"),
    [
        ("amadeus_actions", "pending"),
        ("amadeus_actions", "approved"),
        ("amadeus_actions", "running"),
        ("amadeus_questions", "pending"),
        ("amadeus_runs", "running"),
        ("amadeus_runs", "cancelling"),
        ("amadeus_native_jobs", "leased"),
    ],
)
def test_busy_installation_is_not_touched(installation, table, status):
    root, databases = installation
    with sqlite3.connect(databases["amadeus"]) as connection:
        connection.execute(f"INSERT INTO {table} VALUES (?)", (status,))
    with pytest.raises(CutoverDeferred, match="已延后切换"):
        cutover(
            root,
            databases,
            verify_gate=lambda _: pytest.fail(),
            switch=pytest.fail,
            verify_health=pytest.fail,
            rollback=pytest.fail,
        )
    assert admission_status(root) == "accepting"


def assert_challenge(root, challenge):
    assert (root / "paused").read_text().strip() == challenge


def test_switch_and_rollback_both_hold_admission_until_verified(installation):
    root, databases = installation
    with sqlite3.connect(databases["amadeus"]) as connection:
        connection.execute("INSERT INTO amadeus_runs VALUES ('waiting_approval')")
        connection.execute("INSERT INTO amadeus_actions VALUES ('completed')")
    order = []

    def record(name):
        assert admission_status(root) == "paused"
        order.append(name)

    def switch():
        record("switch")
        raise RuntimeError("switch failed")

    with pytest.raises(RuntimeError, match="switch failed"):
        cutover(
            root,
            databases,
            verify_gate=lambda challenge: (assert_challenge(root, challenge), record("paused")),
            switch=switch,
            verify_health=lambda: record("health"),
            rollback=lambda: record("rollback"),
        )
    assert order == ["paused", "switch", "rollback", "health", "paused"]
    assert admission_status(root) == "accepting"


async def test_existing_request_defers_cutover_and_gate_blocks_new_work(installation):
    root, databases = installation
    entered, finish = asyncio.Event(), asyncio.Event()
    app = FastAPI()
    app.add_middleware(AgentAdmission, root=root, prefixes=("/v1/amadeus/",))

    @app.post("/v1/amadeus/start")
    async def start():
        entered.set()
        await finish.wait()
        return {"ok": True}

    @app.get("/v1/amadeus/read")
    async def read():
        return {"status": "visible"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        first = asyncio.create_task(client.post("/v1/amadeus/start"))
        try:
            await asyncio.wait_for(entered.wait(), 2)
            with pytest.raises(CutoverDeferred, match="请求正在提交"):
                cutover(
                    root,
                    databases,
                    verify_gate=lambda _: None,
                    switch=pytest.fail,
                    verify_health=pytest.fail,
                    rollback=pytest.fail,
                )
            (root / "paused").touch()
            assert (await client.post("/v1/amadeus/start")).status_code == 503
            assert (await client.get("/v1/amadeus/read")).json() == {"status": "visible"}
        finally:
            finish.set()
        assert (await first).status_code == 200
        assert not list((root / "inflight").iterdir())
