"""Keep Galgame video preflight tied to the live Rendering and Assets owners."""

import io
from pathlib import Path

import httpx
from PIL import Image
from starlette.datastructures import UploadFile
from tests.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_galgame_uploads_service import DropAcknowledgement
from tests.test_independent_project_catalog import ORIGIN, authorize

from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.galgame_workshop.storage.migrations.registry import (
    MIGRATIONS as GALGAME_MIGRATIONS,
)
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.media_rendering.local.render_capacity import RenderCapacity
from studio.apps.media_rendering.settings import RenderingSettings
from studio.apps.media_rendering.storage.migrations.registry import (
    MIGRATIONS as RENDERING_MIGRATIONS,
)
from studio.apps.media_rendering.transport import galgame_capacity_http
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS as VIDEO_MIGRATIONS
from studio.assembly.independent.galgame_workshop.application import create_app as create_galgame
from studio.assembly.independent.media_rendering.application import create_app as create_rendering
from studio.assembly.independent.video_editor.application import create_app as create_video
from studio.contracts.thought_workshop.thought_archives import ArchiveAuthenticator
from studio.contracts.video_editor.video_snapshot import ARCHIVE_DOMAIN
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient

PROJECTS = "/v1/galgame-workshop/projects"
VIDEO_PROJECTS = "/v1/video-editor/projects"
ROOT = Path(__file__).resolve().parents[1]


async def test_live_rendering_capacity_and_exact_story_assets_control_preflight(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    galgame_root, render_root = tmp_path / "galgame", tmp_path / "rendering"
    video_root = tmp_path / "video"
    apply(galgame_root / "service.db", "galgame", GALGAME_MIGRATIONS)
    apply(render_root / "service.db", "rendering", RENDERING_MIGRATIONS)
    apply(video_root / "service.db", "video", VIDEO_MIGRATIONS)
    renderer_secret = "isolated-render-capacity-credential-" * 2
    video_secret = "isolated-video-handoff-credential-" * 2
    archive_secret = "isolated-video-archive-handoff-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        galgame=CREDENTIALS["galgame"], rendering=renderer_secret, video=video_secret
    )
    case.assets.state.video_archive_auth = ArchiveAuthenticator(
        archive_secret, domain=ARCHIVE_DOMAIN
    )
    video = create_video(
        state_root=video_root,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        schema_path=ROOT / "web/src/generated/openapi.json",
        credential=video_secret,
        transport=case.mesh,
        archive_key=archive_secret,
        run_worker=False,
    )
    transfer = DropAcknowledgement(case.mesh)
    game = create_galgame(
        state_root=galgame_root,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["galgame"],
        transport=transfer,
        run_worker=False,
    )
    render = create_rendering(
        settings=RenderingSettings(render_root / "service.db"),
        public_key=case.key.public_key(),
        catalog=CATALOG,
        run_worker=False,
        identity=LiveAuthorization(
            service="rendering", credential=renderer_secret, transport=case.mesh
        ),
        capabilities=CapabilityClient(
            service="rendering",
            credential=renderer_secret,
            catalog=CATALOG,
            transport=case.mesh,
        ),
    )
    assets_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = assets_live
    case.mesh.apps.update(galgame=game, rendering=render, video=video)
    monkeypatch.setattr(
        galgame_capacity_http, "galgame_capacity", lambda _root: RenderCapacity((), None, 20 << 30)
    )
    async with (
        assets_live.client,
        game.router.lifespan_context(game),
        render.router.lifespan_context(render),
        video.router.lifespan_context(video),
        httpx.AsyncClient(transport=case.mesh, base_url="http://galgame") as http,
    ):

        async def request(method, path, **kwargs):
            return await http.request(
                method, path, headers=await authorize(case, "galgame", method, path), **kwargs
            )

        project = await request("POST", PROJECTS, json={"title": "Owned render test"})
        assert project.status_code == 200, project.text
        root = f"{PROJECTS}/{project.json()['id']}"
        image = io.BytesIO()
        Image.new("RGB", (4, 4), "purple").save(image, "PNG")
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            asset = await AssetLibrary(db, case.assets.state.settings).store_upload(
                UploadFile(io.BytesIO(image.getvalue()), filename="scene.png"),
                owner_user_id=case.viewer,
            )
        story = (await request("GET", root + "/story")).json()["document"]
        story["assets"] = [
            {
                "id": "scene",
                "fileId": asset.id,
                "role": "sceneLayer",
                "type": "image",
                "status": "ready",
            }
        ]
        story["chapters"][0]["fragments"][0]["blocks"] = [
            {"id": "intro", "type": "narration", "text": "Owned render plan"},
            {"id": "end", "type": "endChapter"},
        ]
        saved = await request(
            "PUT", root + "/story", json={"expected_revision": 0, "document": story}
        )
        assert saved.status_code == 200, saved.text
        preview = root + "/video-exports/preview"
        body = {"expectedStoryRevision": 1, "preset": "720p30"}
        ready = await request("POST", preview, json=body)
        assert ready.status_code == 200 and ready.json()["ready"], ready.text
        assert ready.json()["width"] == 1280 and len(ready.json()["previewFingerprint"]) == 64
        assert (await request("POST", preview, json=body)).json() == ready.json()
        frame_path = root + "/video-exports/frame"
        rendered = await request("POST", frame_path, json={**body, "timeMs": 200, "width": 640})
        assert rendered.status_code == 200, rendered.text
        assert rendered.headers["content-type"] == "image/png"
        with Image.open(io.BytesIO(rendered.content)) as result:
            assert result.size == (640, 360)
        repeated = await request("POST", frame_path, json={**body, "timeMs": 200, "width": 640})
        assert repeated.content == rendered.content
        too_late = await request("POST", frame_path, json={**body, "timeMs": 100_000})
        assert too_late.status_code == 422 and too_late.json()["code"] == "invalid_time"
        path = root + "/video-exports"
        options = {
            **body,
            "requestId": "actual-export",
            "previewFingerprint": ready.json()["previewFingerprint"],
        }
        wrong = await request("POST", path, json={**options, "previewFingerprint": "0" * 64})
        assert wrong.status_code == 409 and wrong.json()["code"] == "preview_conflict"
        queued = await request("POST", path, json=options)
        assert queued.status_code == 202 and queued.json()["status"] == "queued", queued.text
        assert (await request("POST", path, json=options)).json() == queued.json()
        target = f"{path}/{queued.json()['id']}"
        gallery = game.state.export_runner
        await gallery.process_once()
        await render.state.galgame_exports.process_once()
        transfer.drop_next = True
        await gallery.process_once()
        interrupted = await request("GET", target)
        assert transfer.dropped, interrupted.text
        assert interrupted.json()["phase"] == "registering"
        await gallery.recover()
        await game.state.upload_intakes.process_once()
        await gallery.process_once()
        completed = await request("GET", target)
        assert completed.json()["status"] == "completed", completed.text
        output = await request("GET", target + "/download")
        assert output.status_code == 200 and b"ftyp" in output.content[:16], output.text[:60]
        assert output.headers["content-type"] == "video/mp4"
        assets = (await request("GET", root + "/assets")).json()["items"]
        exported = [item for item in assets if item["id"] == completed.json()["outputAssetId"]]
        assert len(exported) == 1
        assert exported[0]["packagingPolicy"] == "include" and exported[0]["width"] == 1280
        await gallery.process_once()

        cancelling = await request("POST", path, json={**options, "requestId": "cancel-export"})
        cancelled_path = f"{path}/{cancelling.json()['id']}"
        await gallery.process_once()
        cancelled = await request("POST", cancelled_path + "/cancel")
        assert cancelled.status_code == 200 and cancelled.json()["cancelRequested"]
        await gallery.process_once()
        cancelled_result = await request("GET", cancelled_path)
        assert cancelled_result.json()["status"] == "cancelled", cancelled_result.text

        stale = await request("POST", preview, json={**body, "expectedStoryRevision": 0})
        assert stale.status_code == 200
        assert {item["code"] for item in stale.json()["blockers"]} == {"story_revision_conflict"}
        monkeypatch.setattr(
            galgame_capacity_http,
            "galgame_capacity",
            lambda _root: RenderCapacity(("ffmpeg",), "字体不可读", 0),
        )
        unavailable = await request("POST", preview, json=body)
        assert unavailable.status_code == 200 and not unavailable.json()["ready"], unavailable.text
        assert {item["code"] for item in unavailable.json()["blockers"]} == {
            "renderer_dependency_missing",
            "renderer_font_missing",
            "insufficient_disk_space",
        }
        assert unavailable.json()["previewFingerprint"] == ready.json()["previewFingerprint"]

        monkeypatch.setattr(
            galgame_capacity_http,
            "galgame_capacity",
            lambda _root: RenderCapacity((), None, 20 << 30),
        )
        handoffs = root + "/video-editor-handoffs"
        handoff_options = {**options, "requestId": "actual-handoff", "title": "Owned timeline"}
        handoff = await request("POST", handoffs, json=handoff_options)
        assert handoff.status_code == 202, handoff.text
        handoff_path = f"{handoffs}/{handoff.json()['id']}"
        runner = game.state.handoff_runner
        await runner.process_once()
        await render.state.galgame_exports.process_once()
        transfer.drop_video_handoff = True
        await runner.process_once()
        pending = await request("GET", handoff_path)
        assert not transfer.drop_video_handoff and pending.json()["status"] == "running", (
            pending.text
        )
        read_back = await authorize(case, "galgame", "GET", handoff_path)
        logout = await case.browser.post(
            "/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": case.csrf}
        )
        assert logout.status_code == 204
        await runner.recover()
        await runner.process_once()
        finished = await http.get(handoff_path, headers=read_back)
        assert finished.json()["status"] == "completed", finished.text

        signed_in = await case.browser.post(
            "/v1/auth/login", json={"username": "viewing-user", "password": PASSWORD}
        )
        assert signed_in.status_code == 200, signed_in.text
        case.csrf = case.browser.cookies["fpl_csrf"]
        final = finished.json()
        assert final["trackCount"] > 0 and final["assetCount"] > 0
        assert (await request("POST", handoffs, json=handoff_options)).json() == final
        projects = await http.get(
            "http://video" + VIDEO_PROJECTS,
            headers=await authorize(case, "video", "GET", VIDEO_PROJECTS),
        )
        assert projects.status_code == 200, projects.text
        assert [item["id"] for item in projects.json()["items"]] == [final["outputProjectId"]]
        destination = VIDEO_PROJECTS + "/" + final["outputProjectId"]
        got = await http.get(
            "http://video" + destination, headers=await authorize(case, "video", "GET", destination)
        )
        assert got.status_code == 200, got.text
        assert got.json()["title"] == "Owned timeline"
        assert got.json()["sourceApplication"] == "galgame-workshop"
        assert got.json()["sourceProjectId"] == project.json()["id"]
        assert got.json()["sourceRevision"] == 1

        timeline_path = destination + "/timeline"
        timeline = await http.get(
            "http://video" + timeline_path,
            headers=await authorize(case, "video", "GET", timeline_path),
        )
        assert timeline.status_code == 200, timeline.text
        assert len(timeline.json()["document"]["tracks"]) == final["trackCount"]

        removed = await request("DELETE", root, params={"expected_revision": 0})
        assert removed.status_code == 200 and removed.json() == {"deleted": True}, removed.text
