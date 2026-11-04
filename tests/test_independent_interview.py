"""Interview room and material writes stay inside their independent owner."""

from pathlib import Path

import httpx
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_interview.application import create_app
from fpl_interview.migrations.registry import MIGRATIONS
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
BASE = "/v1/interview-assistant"
ROOMS = BASE + "/rooms"


async def test_room_receipt_and_material_survive_independent_restart(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "interview"
    apply(state / "service.db", "interview", MIGRATIONS)

    def application():
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
        )

    async def call(client, method, path, **kwargs):
        headers = await authorize(case, "interview", method, path)
        return await client.request(method, path, headers=headers, **kwargs)

    def client(app):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://interview"
        )

    create = {"title": "Retained interview", "request_id": "independent-interview-create"}
    data = b"# Interview material\nA fictional candidate.\n"
    app = application()
    async with app.router.lifespan_context(app), client(app) as api:
        assert (await api.get(ROOMS)).status_code == 401
        assert (await api.get("/ready")).status_code == 503
        executor = await call(api, "GET", BASE + "/executor")
        assert executor.json()["available"] is False
        created = await call(api, "POST", ROOMS, json=create)
        assert created.status_code == 201, created.text
        room = created.json()
        path = f"{ROOMS}/{room['id']}"
        uploaded = await call(
            api,
            "POST",
            path + "/materials",
            params={"expected_revision": 0},
            files={"file": ("candidate.md", data)},
        )
        assert uploaded.status_code == 200, uploaded.text
        material = uploaded.json()["materials"][0]
        download = f"{path}/materials/{material['id']}/download"
        assert (await call(api, "GET", download)).content == data
        stale = await call(
            api,
            "POST",
            path + "/materials",
            params={"expected_revision": 0},
            files={"file": ("duplicate.md", data)},
        )
        assert stale.status_code == 409
        assert len(list(state.glob("accounts/*/interview-assistant/*/materials/*"))) == 1

    restarted = application()
    async with restarted.router.lifespan_context(restarted), client(restarted) as api:
        repeated = await call(api, "POST", ROOMS, json=create)
        assert repeated.json() == uploaded.json()
        assert (await call(api, "GET", download)).content == data
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await call(api, "GET", path)).status_code == 404
        assert (await call(api, "GET", download)).status_code == 404
