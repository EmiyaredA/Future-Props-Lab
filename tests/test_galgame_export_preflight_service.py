"""Keep Galgame video preflight tied to the live Rendering and Assets owners."""

import io

import httpx
from PIL import Image
from starlette.datastructures import UploadFile
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.media_rendering.render_capacity import RenderCapacity
from fpl_galgame.application import create_app as create_galgame
from fpl_galgame.migrations.registry import MIGRATIONS as GALGAME_MIGRATIONS
from fpl_rendering import galgame_capacity_http
from fpl_rendering.application import create_app as create_rendering
from fpl_rendering.migrations.registry import MIGRATIONS as RENDERING_MIGRATIONS
from fpl_rendering.settings import RenderingSettings
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply

PROJECTS = "/v1/galgame-workshop/projects"


async def test_live_rendering_capacity_and_exact_story_assets_control_preflight(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    galgame_root, render_root = tmp_path / "galgame", tmp_path / "rendering"
    apply(galgame_root / "service.db", "galgame", GALGAME_MIGRATIONS)
    apply(render_root / "service.db", "rendering", RENDERING_MIGRATIONS)
    renderer_secret = "isolated-render-capacity-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        galgame=CREDENTIALS["galgame"], rendering=renderer_secret
    )
    game = create_galgame(
        state_root=galgame_root,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["galgame"],
        transport=case.mesh,
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
    case.mesh.apps.update(galgame=game, rendering=render)
    monkeypatch.setattr(
        galgame_capacity_http, "galgame_capacity", lambda _root: RenderCapacity((), None, 20 << 30)
    )
    async with (
        assets_live.client,
        game.router.lifespan_context(game),
        render.router.lifespan_context(render),
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
