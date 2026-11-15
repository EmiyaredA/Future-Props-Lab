"""A preview stays at Rendering and cleanup survives source-project removal."""

from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.media_rendering.settings import RenderingSettings
from studio.apps.media_rendering.storage.migrations.registry import MIGRATIONS as RENDER_MIGRATIONS
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.media_rendering.application import create_app as render_app
from studio.assembly.independent.video_editor import application as video_application
from studio.assembly.independent.video_editor.application import PROJECTS, create_app
from studio.contracts.video_editor.video_exports import EXPORTS
from studio.contracts.video_editor.video_processing import originals_peer, video_peer
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.apps.video_editor.test_independent_video_derivatives import (
    MEDIA_KEY,
    ORIGINALS_KEY,
    RENDER_TOKEN,
    VIDEO_TOKEN,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    ("method", "suffix"),
    [("GET", ""), ("POST", ""), ("DELETE", ""), ("POST", "/task/cancel"), ("GET", "/task/media")],
)
def test_video_startup_rejects_missing_packaged_preview_permission(
    tmp_path, monkeypatch, method, suffix
):
    permission = video_application.route_permission
    missing = f"{PROJECTS}/{{project_id}}/preview/renders{suffix}"
    missing = missing.replace("/task/", "/{task_id}/")
    monkeypatch.setattr(
        video_application,
        "route_permission",
        lambda verb, path: None if (verb, path) == (method, missing) else permission(verb, path),
    )
    with pytest.raises(ValueError, match="未登记的账号权限"):
        create_app(
            state_root=tmp_path / "video",
            catalog=CATALOG,
            public_key=Ed25519PrivateKey.generate().public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
            credential=VIDEO_TOKEN,
            run_worker=False,
        )


@pytest.mark.asyncio
async def test_independent_preview_receipt_stream_restart_cancel_and_project_cleanup(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    case.identity.state.identity_options["service_credentials"].update(
        video=VIDEO_TOKEN, rendering=RENDER_TOKEN
    )
    authority = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = authority
    case.assets.state.video_originals_peer = originals_peer(ORIGINALS_KEY)
    render_db, video_root = tmp_path / "rendering" / "service.db", tmp_path / "video"
    apply(render_db, "rendering", RENDER_MIGRATIONS)
    apply(video_root / "service.db", "video", MIGRATIONS)
    rendering = render_app(
        settings=RenderingSettings(render_db),
        catalog=CATALOG,
        public_key=case.key.public_key(),
        identity=LiveAuthorization(
            service="rendering", credential=RENDER_TOKEN, transport=case.mesh
        ),
        capabilities=CapabilityClient(
            service="rendering", credential=RENDER_TOKEN, catalog=CATALOG, transport=case.mesh
        ),
        run_worker=False,
        video_media_key=MEDIA_KEY,
        video_originals_key=ORIGINALS_KEY,
    )
    case.mesh.apps["rendering"] = rendering
    video = create_app(
        state_root=video_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        schema_path=ROOT / "web/src/generated/openapi.json",
        credential=VIDEO_TOKEN,
        transport=case.mesh,
        run_worker=False,
        media_key=MEDIA_KEY,
    )

    async def send(api, method, path, **kwargs):
        headers = await authorize(case, "video", method, path)
        headers.update(kwargs.pop("headers", {}))
        return await api.request(method, path, headers=headers, **kwargs)

    async with (
        authority.client,
        video.router.lifespan_context(video),
        rendering.router.lifespan_context(rendering),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=video), base_url="http://video") as api,
        httpx.AsyncClient(transport=case.mesh) as internal,
    ):
        created = await send(api, "POST", PROJECTS, json={"title": "Preview"})
        assert created.status_code == 200, created.text
        project = f"{PROJECTS}/{created.json()['id']}"
        seeded = await send(
            api,
            "POST",
            project + "/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "seed-preview",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "color",
                            "name": "Color",
                            "trackId": "visual-1",
                            "kind": "color",
                            "color": "#123456",
                            "timelineStartUs": 0,
                            "durationUs": 100_000,
                        },
                    }
                ],
            },
        )
        assert seeded.status_code == 200, seeded.text
        route = project + "/preview/renders"
        created = await send(
            api, "POST", route, json={"expectedRevision": 1, "requestId": "preview-remote"}
        )
        assert created.status_code == 200, created.text
        task_id = created.json()["id"]
        bridge, exports = video.state.render_delivery, rendering.state.video_exports
        await bridge.process_once()
        await exports.process_once()
        job = await exports.load(case.viewer, task_id)
        assert job.status == "completed" and job.result == {}, job.error
        folder = exports.folder(case.viewer, task_id)
        assert (folder / "sealed/movie.mp4").is_file()
        assert await exports.load(case.owner, task_id) is None
        # A completed retained output survives worker recovery and source receipt loss.
        await exports.recover()
        await bridge.process_once()
        status = (await send(api, "GET", route)).json()["items"][0]
        assert status["valid"] and status["outputAssetId"] is None
        media = await send(api, "GET", status["mediaUrl"], headers={"Range": "bytes=0-31"})
        assert media.status_code == 206, media.text
        assert len(media.content) == 32 and b"ftyp" in media.content[:16]
        wrong_path = f"{EXPORTS}/{task_id}/preview"
        wrong_headers = video_peer(MEDIA_KEY).headers("GET", wrong_path, case.owner)
        assert (
            await internal.get("http://rendering" + wrong_path, headers=wrong_headers)
        ).status_code == 404
        # Cleanup stays in the durable dispatch after the public task is retired.
        await send(api, "DELETE", route)

        async def unavailable(_job):
            return False

        with monkeypatch.context() as fault:
            fault.setattr(exports, "purge_preview", unavailable)
            await bridge.process_once()
        assert folder.is_dir()
        await bridge.process_once()
        assert not folder.exists()
        assert await exports.load(case.viewer, task_id) is None
        cancelled = await send(
            api, "POST", route, json={"expectedRevision": 1, "requestId": "preview-cancel-remote"}
        )
        cancelled_id = cancelled.json()["id"]
        await send(api, "POST", route + f"/{cancelled_id}/cancel")
        await bridge.process_once()
        assert (await send(api, "GET", route)).json()["items"][0]["status"] == "cancelled"
        final = await send(
            api, "POST", route, json={"expectedRevision": 1, "requestId": "preview-delete-project"}
        )
        final_id = final.json()["id"]
        for _ in range(3):
            await bridge.process_once()
        await exports.process_once()
        for _ in range(3):
            await bridge.process_once()
        folder = exports.folder(case.viewer, final_id)
        assert folder.is_dir()
        removed = await send(api, "DELETE", project, params={"expected_revision": 0})
        assert removed.status_code == 200, removed.text
        for _ in range(3):
            await bridge.process_once()
        assert not folder.exists()
        assert await exports.load(case.viewer, final_id) is None
