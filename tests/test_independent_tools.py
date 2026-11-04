"""Account-scoped navigation persists through the independent Tools service."""

import asyncio
import json
from pathlib import Path

import httpx
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_runtime.migrations import apply
from fpl_tools.application import create_app
from fpl_tools.migrations.registry import MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]
STATE = "/v1/tool-navigation/state"
TOOL = "/v1/tool-navigation/tools/json-formatter"


async def test_tools_state_uses_its_own_account_database(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "tools"
    apply(root / "service.db", "tools", MIGRATIONS)

    def application():
        return create_app(state_root=root, catalog=CATALOG, public_key=case.key.public_key())

    app = application()
    published = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    template = "/v1/tool-navigation/tools/{tool_id}"
    for path in (STATE, template, template + "/use"):
        assert app.openapi()["paths"][path] == published[path]

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://tools") as api,
    ):
        assert (await api.get(STATE)).status_code == 401
        assert (await api.get("/ready")).status_code == 503
        read = await authorize(case, "tools", "GET", STATE)
        write = await authorize(case, "tools", "PATCH", TOOL)
        use = await authorize(case, "tools", "POST", TOOL + "/use")
        assert (await api.get(STATE, headers=read)).json() == {"items": []}
        results = await asyncio.gather(
            api.patch(TOOL, headers=write, json={"is_favorite": True}),
            *(api.post(TOOL + "/use", headers=use) for _ in range(6)),
        )
        assert all(result.status_code == 200 for result in results)
        assert sorted(result.json()["use_count"] for result in results[1:]) == list(range(1, 7))

    restarted = application()
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://tools"
        ) as api,
    ):
        state = await api.get(STATE, headers=await authorize(case, "tools", "GET", STATE))
        item = state.json()["items"][0]
        assert item["use_count"] == 6 and item["is_favorite"] is True

        switched = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert switched.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        other = await authorize(case, "tools", "GET", STATE)
        assert (await api.get(STATE, headers=other)).json() == {"items": []}
