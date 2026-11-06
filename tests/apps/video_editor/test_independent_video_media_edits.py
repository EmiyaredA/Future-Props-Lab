"""Video asset edits settle exact owned Assets names and local effects together."""

from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.video_editor.application import PROJECTS, create_app
from studio.runtime.database.migrations import apply
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[3]


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


async def test_asset_removal_settles_and_rechecks_inflight_timeline(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    import asyncio

    from studio.apps.video_editor.timeline_media import TimelineMedia

    case = scenario
    credential = "isolated-video-removal-credential"
    case.identity.state.identity_options["service_credentials"]["video"] = credential
    identity = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = identity
    state = tmp_path / "video"
    apply(state / "service.db", "video", MIGRATIONS)
    faults = LoseNameReply(case.mesh)
    video = create_app(
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

    async with (
        video.router.lifespan_context(video),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=video), base_url="http://video") as api,
    ):
        created = await send(api, "POST", PROJECTS, json={"title": "Remove Media"})
        assert created.status_code == 200, created.text
        project = PROJECTS + "/" + created.json()["id"]
        files, operations = project + "/assets", project + "/timeline/operations"
        original = BytesIO()
        Image.new("RGB", (3, 3), "cyan").save(original, format="PNG")
        raw = original.getvalue()

        async def upload(name):
            result = await send(api, "POST", files, files={"upload": (name, raw, "image/png")})
            assert result.status_code == 200, result.text
            return result.json()["id"]

        attached = await upload("attached.png")
        racing = await upload("racing.png")

        def append_clip(identity, revision, name):
            return {
                "expectedRevision": revision,
                "requestId": "video-removal-" + name,
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": name,
                            "trackId": "visual-1",
                            "kind": "image",
                            "name": name,
                            "durationUs": 1_000_000,
                            "timelineStartUs": revision * 1_000_000,
                            "assetId": identity,
                        },
                    }
                ],
            }

        linked = await send(api, "POST", operations, json=append_clip(attached, 0, "active"))
        assert linked.status_code == 200, linked.text
        protected = await send(api, "DELETE", files + "/" + attached)
        assert protected.status_code == 422 and protected.json()["code"] == "asset_in_use"
        no_scope = await send(api, "DELETE", files + "/" + case.asset)
        assert no_scope.status_code == 404

        validated, resume = asyncio.Event(), asyncio.Event()
        normal_guard = TimelineMedia.guard_write

        async def hold_guard(self, project):
            validated.set()
            await asyncio.wait_for(resume.wait(), 5)
            await normal_guard(self, project)

        monkeypatch.setattr(TimelineMedia, "guard_write", hold_guard)
        in_flight = asyncio.create_task(
            send(api, "POST", operations, json=append_clip(racing, 1, "inflight"))
        )
        try:
            await asyncio.wait_for(validated.wait(), 5)
            faults.suffix = "/commit"
            removed = await send(api, "DELETE", files + "/" + racing)
            assert removed.status_code == 503 and faults.suffix is None, removed.text
        finally:
            resume.set()
            conflict = await in_flight
        assert conflict.status_code == 422 and conflict.json()["code"] == "invalid_asset"
        await video.state.reference_delivery.process_once()
        assert (await send(api, "GET", project + "/timeline")).json() == linked.json()
        found = (await send(api, "GET", files)).json()["items"]
        assert [item["id"] for item in found] == [attached]
        assert (await send(api, "DELETE", files + "/" + racing)).status_code == 404
        assert await case.assets.state.file_cleanup.run_once() == 1

        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            assert await db.get(VisualAsset, racing) is None
            assert await db.get(VisualAsset, attached) is not None
    await identity.close()
