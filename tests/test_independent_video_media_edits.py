"""Video asset edits settle exact owned Assets names and local effects together."""

from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image
from tests.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_video.application import PROJECTS, create_app
from fpl_video.migrations.registry import MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]


class LoseNameReply(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.suffix = None

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            self.suffix
            and request.url.host == "assets"
            and request.url.path.startswith("/_internal/v1/retention/")
            and request.url.path.endswith(self.suffix)
            and response.status_code == 200
        ):
            self.suffix = None
            await response.aclose()
            raise httpx.ReadError("lost isolated rename acknowledgement", request=request)
        return response


async def test_asset_patch_recovers_both_sides_of_the_commit(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "video"
    apply(state / "service.db", "video", MIGRATIONS)
    credential = "isolated-video-metadata-credential"
    case.identity.state.identity_options["service_credentials"]["video"] = credential
    identity = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = identity
    faults = LoseNameReply(case.mesh)

    def app():
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
            credential=credential,
            transport=faults,
            run_worker=False,
        )

    async def send(api, method, path, **kwargs):
        return await api.request(
            method, path, headers=await authorize(case, "video", method, path), **kwargs
        )

    source = BytesIO()
    Image.new("RGB", (3, 3), "blue").save(source, format="PNG")
    raw = source.getvalue()
    first = app()
    async with (
        first.router.lifespan_context(first),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=first), base_url="http://video") as api,
    ):
        project = await send(api, "POST", PROJECTS, json={"title": "Media edits"})
        assert project.status_code == 200, project.text
        files = PROJECTS + "/" + project.json()["id"] + "/assets"
        upload = await send(api, "POST", files, files={"upload": ("base.png", raw, "image/png")})
        assert upload.status_code == 200, upload.text
        asset = upload.json()["id"]
        path = files + "/" + asset
        payload = {"displayName": "Renamed", "expectedRevision": upload.json()["revision"]}
        faults.suffix = "/prepare"
        response = await send(api, "PATCH", path, json=payload)
        assert response.status_code == 503 and faults.suffix is None, response.text
        await first.state.reference_delivery.process_once()
        assert (await send(api, "GET", files)).json()["items"] == [upload.json()]

        faults.suffix = "/commit"
        response = await send(api, "PATCH", path, json=payload)
        assert response.status_code == 503 and faults.suffix is None, response.text

    second = app()
    async with (
        second.router.lifespan_context(second),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second), base_url="http://video"
        ) as api,
    ):
        await second.state.reference_delivery.process_once()
        found = (await send(api, "GET", files)).json()["items"]
        assert len(found) == 1
        assert (
            found[0]["displayName"] == "Renamed"
            and found[0]["revision"] == payload["expectedRevision"] + 1
        )
        response = await send(api, "PATCH", path, json=payload)
        assert response.status_code == 409, response.text
        effects = await send(
            api,
            "PATCH",
            path,
            json={"defaultEffects": {}, "expectedRevision": found[0]["revision"]},
        )
        assert effects.status_code == 200, effects.text
        assert (
            effects.json()["displayName"] == "Renamed"
            and effects.json()["revision"] == found[0]["revision"] + 1
        )

        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            row = await db.get(VisualAsset, asset)
            assert row.display_name == "Renamed" and row.revision == 0
            assert AssetStorage(case.assets.state.settings).path_for(row).read_bytes() == raw
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await send(api, "PATCH", path, json=payload)).status_code == 404
    await identity.close()
