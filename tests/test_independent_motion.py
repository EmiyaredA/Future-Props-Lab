"""Standalone Motion keeps revisions, edit replay and file scope across restarts."""

from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image
from starlette.datastructures import Headers, UploadFile
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from fpl_motion.application import PROJECTS, create_app
from fpl_motion.migrations.registry import MIGRATIONS
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "motion-identity-fixture-secret-unique"


async def test_motion_project_metadata_checks_exact_project_and_owner(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "motion"
    apply(state / "service.db", "motion", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["motion"] = TOKEN

    def app():
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            credential=TOKEN,
            schema_path=ROOT / "web/src/generated/openapi.json",
            transport=case.mesh,
        )

    async def call(client, method, path, **kwargs):
        headers = await authorize(case, "motion", method, path)
        return await client.request(method, path, headers=headers, **kwargs)

    async def upload(project_id):
        body = BytesIO()
        Image.new("RGB", (4, 4), "green").save(body, format="PNG")
        body.seek(0)
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            row = await AssetLibrary(db, case.assets.state.settings).store_upload(
                UploadFile(
                    body, filename="shape.png", headers=Headers({"Content-Type": "image/png"})
                ),
                owner_user_id=case.viewer,
                motion_compositor_project_id=project_id,
            )
            return row.id

    first = app()
    async with (
        first.router.lifespan_context(first),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first), base_url="http://motion"
        ) as api,
    ):
        assert (await api.get("/ready")).status_code == 503
        assert (await api.get(PROJECTS)).status_code == 401
        created = await call(api, "POST", PROJECTS, json={"title": "Owned motion"})
        assert created.status_code == 200, created.text
        row = created.json()
        project_id = row["id"]
        project = f"{PROJECTS}/{project_id}"
        assert (await call(api, "GET", PROJECTS)).json()["items"] == [row]
        document = project + "/document"
        assert (await call(api, "GET", document)).json()["revision"] == 0
        owned = await upload(project_id)
        foreign = await upload(None)
        layer = {
            "id": "owned-layer",
            "kind": "image",
            "name": "Owned media",
            "assetId": foreign,
            "width": 80,
            "height": 80,
            "endFrame": 180,
        }
        edit = {
            "expectedRevision": 0,
            "requestId": "retained-motion-edit",
            "operations": [{"type": "addLayer", "layer": layer}],
        }
        rejected = await call(api, "POST", document + "/operations", json=edit)
        assert rejected.status_code == 422, rejected.text
        layer["assetId"] = owned
        applied = await call(api, "POST", document + "/operations", json=edit)
        assert applied.status_code == 200, applied.text
        assert applied.json()["revision"] == 1
        rename = await call(
            api, "PATCH", project, json={"title": "Renamed motion", "expectedRevision": 0}
        )
        assert rename.status_code == 200, rename.text
        assert rename.json()["revision"] == 1

    restarted = app()
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://motion"
        ) as api,
    ):
        assert (await call(api, "GET", project)).json() == rename.json()
        assert (await call(api, "GET", document)).json() == applied.json()
        replay = await call(api, "POST", document + "/operations", json=edit)
        assert replay.json() == applied.json()
        stale = await call(api, "PATCH", project, json={"title": "Stale", "expectedRevision": 0})
        assert stale.status_code == 409
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200, login.text
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await call(api, "GET", project)).status_code == 404
        assert (await call(api, "GET", PROJECTS)).json()["items"] == []
