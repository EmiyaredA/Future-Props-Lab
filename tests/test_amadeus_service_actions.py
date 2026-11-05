"""One-shot action approval and outcomes in the independent service."""

import asyncio

import httpx
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_amadeus.application import create_app
from fpl_amadeus.migrations.registry import MIGRATIONS
from fpl_runtime.migrations import apply


async def test_action_stream_claim_and_write_share_the_same_approval(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "amadeus"
    root.mkdir()
    apply(root / "service.db", "amadeus", MIGRATIONS)
    credential = "isolated-amadeus-action-token-" * 2
    case.identity.state.identity_options["service_credentials"]["amadeus"] = credential
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=credential,
        transport=case.mesh,
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        path = "/v1/amadeus/conversations"
        created = await send("POST", path)
        assert created.status_code == 200, created.text
        path += "/" + created.json()["id"]
        proposal = await send(
            "POST",
            path + "/actions",
            json={
                "tool_name": "write_work_file",
                "arguments": {"name": "owned.txt", "content": "Approved content"},
            },
        )
        assert proposal.status_code == 200, proposal.text
        record = proposal.json()
        action = f"{path}/actions/{record['id']}"
        execute = action + "/execute"
        assert (await send("POST", execute)).status_code == 409
        assert (
            await send(
                "POST", action + "/decision", json={"arguments_sha256": "0" * 64, "approve": True}
            )
        ).status_code == 409
        approved = await send(
            "POST",
            action + "/decision",
            json={"arguments_sha256": record["arguments_sha256"], "approve": True},
        )
        assert approved.status_code == 200, approved.text
        first, second = await asyncio.gather(
            send("POST", execute), send("POST", execute + "/stream")
        )
        assert second.headers["Content-Type"].startswith("application/x-ndjson")
        if first.status_code == 200:
            assert first.json()["status"] == "completed"
            assert second.json()["code"] == "approval_conflict"
        else:
            assert first.status_code == 409
            assert second.json()["type"] == "end"
            assert second.json()["action"]["status"] == "completed"
        file = await send("GET", path + "/files/outputs/owned.txt")
        assert file.content == b"Approved content"
        assert (await send("POST", action + "/cancel")).status_code == 409
