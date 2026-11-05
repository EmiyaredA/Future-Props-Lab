"""Exercise independently owned Amadeus history and restart without Identity tables."""

import json
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusRun,
)
from fpl_amadeus.application import create_app
from fpl_amadeus.migrations.registry import MIGRATIONS
from fpl_runtime.claims import HEADER, issue_context, verify_context
from fpl_runtime.migrations import apply

SOURCE = "/v1/amadeus/conversations"


async def test_amadeus_record_contracts_ownership_and_recovery(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    apply(tmp_path / "service.db", "amadeus", MIGRATIONS)

    def application():
        return create_app(
            state_root=tmp_path,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            credential="isolated-amadeus-service-credential-" * 2,
        )

    app = application()
    published = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )["paths"]
    for path, methods in app.openapi()["paths"].items():
        if path.startswith("/v1/"):
            for method, operation in methods.items():
                assert operation == published[path][method]
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):
        assert (await api.get(SOURCE)).status_code == 401

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        created = await send("POST", SOURCE)
        assert created.status_code == 200, created.text
        identity = created.json()["id"]
        path = SOURCE + "/" + identity
        saved = await send("PATCH", path, json={"expected_revision": 0, "title": "Owned history"})
        assert saved.status_code == 200, saved.text
        stale = await send("PATCH", path, json={"expected_revision": 0, "title": "Stale"})
        assert stale.status_code == 409
        headers = await authorize(case, "amadeus", "GET", path)
        actor = verify_context(
            headers[HEADER],
            service="amadeus",
            method="GET",
            path=path,
            public_key=case.key.public_key(),
        )
        other = issue_context(
            replace(actor, user_id=case.owner),
            service="amadeus",
            method="GET",
            path=path,
            private_key=case.key,
            key_id="fixture",
        )
        assert (await api.get(path, headers={HEADER: other})).status_code == 404
        run_id = str(uuid4())
        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            db.add(
                AmadeusRun(
                    id=run_id,
                    conversation_id=identity,
                    owner_user_id=case.viewer,
                    user_id=case.viewer,
                    agent_id="codex",
                    model_id="code-agent",
                    status="running",
                    active_owner_key=case.viewer + ":" + case.viewer,
                    partial_text="Saved partial",
                )
            )
            await db.flush()
            db.add(
                AmadeusAction(
                    conversation_id=identity,
                    owner_user_id=case.viewer,
                    user_id=case.viewer,
                    tool_name="write_work_file",
                    arguments_json={},
                    arguments_sha256="0" * 64,
                    status="running",
                    run_id=run_id,
                )
            )
            await db.commit()
        assert (await send("GET", path + "/runs/" + run_id)).json()["run"]["status"] == "running"

    restarted = application()
    async with restarted.router.lifespan_context(restarted):
        async with restarted.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            run = await db.get(AmadeusRun, run_id)
            assert run.status == "interrupted" and run.active_owner_key is None
            message = await db.scalar(select(AmadeusMessage))
            action = await db.scalar(select(AmadeusAction))
            assert message.content == "Saved partial" and action.status == "unknown"
            assert (await db.get(AmadeusConversation, identity)).title == "Owned history"

        folder = tmp_path / "accounts" / case.viewer / "amadeus" / identity
        folder.mkdir(parents=True)
        (folder / "output.txt").write_text("isolated owned work file")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://amadeus"
        ) as api:
            deleted = await api.delete(
                path,
                params={"expected_revision": saved.json()["revision"]},
                headers=await authorize(case, "amadeus", "DELETE", path),
            )
            assert deleted.status_code == 200, deleted.text
        assert not folder.exists()
