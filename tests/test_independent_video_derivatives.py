"""Video processing recovers the original Rendering job and keeps files private."""

from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_rendering.application import create_app as render_app
from fpl_rendering.migrations.registry import MIGRATIONS as RENDER_MIGRATIONS
from fpl_rendering.settings import RenderingSettings
from fpl_runtime.capability_client import CapabilityClient, CapabilityUnavailable
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.video_processing import JOBS, ORIGINALS, originals_peer, video_peer
from fpl_video.application import PROJECTS, create_app
from fpl_video.migrations.registry import MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]
VIDEO_TOKEN = "isolated-video-derivatives-client-credential"
RENDER_TOKEN = "isolated-video-rendering-client-credential"
MEDIA_KEY = "isolated-video-rendering-specific-job-key"
ORIGINALS_KEY = "isolated-rendering-assets-specific-originals-key"


class DropJobReply(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.submissions = []

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            request.url.host == "rendering"
            and request.method == "POST"
            and request.url.path.startswith(JOBS + "/")
            and response.status_code == 200
        ):
            self.submissions.append(request.url.path)
            if len(self.submissions) == 1:
                await response.aclose()
                raise httpx.ReadError("isolated rendering receipt dropped", request=request)
        return response


async def test_video_rendering_lost_reply_owner_isolation_and_removal(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    case.identity.state.identity_options["service_credentials"].update(
        video=VIDEO_TOKEN, rendering=RENDER_TOKEN
    )
    assets_authority = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.identity = assets_authority
    case.assets.state.video_originals_peer = originals_peer(ORIGINALS_KEY)
    render_db = tmp_path / "rendering" / "service.db"
    video_root = tmp_path / "video"
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
    faults = DropJobReply(case.mesh)
    video = create_app(
        state_root=video_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        schema_path=ROOT / "web/src/generated/openapi.json",
        credential=VIDEO_TOKEN,
        transport=faults,
        run_worker=False,
        media_key=MEDIA_KEY,
    )

    async def send(client, method, path, **kwargs):
        headers = await authorize(case, "video", method, path)
        headers.update(kwargs.pop("headers", {}))
        return await client.request(method, path, headers=headers, **kwargs)

    async with (
        assets_authority.client,
        video.router.lifespan_context(video),
        rendering.router.lifespan_context(rendering),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=video), base_url="http://video") as api,
        httpx.AsyncClient(transport=case.mesh) as internal,
    ):
        created = await send(api, "POST", PROJECTS, json={"title": "Derivatives"})
        assert created.status_code == 200, created.text
        project_id = created.json()["id"]
        project = f"{PROJECTS}/{project_id}"
        files = project + "/assets"
        image = BytesIO()
        Image.new("RGB", (5, 5), "teal").save(image, format="PNG")
        raw = image.getvalue()
        uploaded = await send(api, "POST", files, files={"upload": ("owned.png", raw, "image/png")})
        assert uploaded.status_code == 200, uploaded.text
        asset = uploaded.json()
        source = f"{ORIGINALS}/{project_id}/{asset['id']}"
        wrong = originals_peer(ORIGINALS_KEY).headers("GET", source, case.owner)
        assert (await internal.get("http://assets" + source, headers=wrong)).status_code == 404
        assert (await internal.get("http://assets" + source)).status_code == 403

        delivery = video.state.media_delivery
        with pytest.raises(CapabilityUnavailable):
            await delivery.process_once()
        job_path = faults.submissions[0].rsplit("/", 2)[0]
        job_id = job_path.rsplit("/", 1)[-1]
        jobs = rendering.state.video_jobs
        assert (await jobs.load(case.viewer, job_id)).status == "queued"
        await jobs.process_once()
        await delivery.process_once()
        assert len(faults.submissions) == 1
        asset = (await send(api, "GET", files)).json()["items"][0]
        assert asset["processingStatus"] == "ready"
        thumbnail = await send(api, "GET", asset["thumbnailUrl"])
        assert thumbnail.status_code == 200 and thumbnail.content.startswith(b"\x89PNG")
        part = await send(api, "GET", asset["thumbnailUrl"], headers={"Range": "bytes=0-7"})
        assert part.status_code == 206 and part.content == thumbnail.content[:8]
        foreign = video_peer(MEDIA_KEY).headers("GET", job_path, case.owner)
        assert (
            await internal.get("http://rendering" + job_path, headers=foreign)
        ).status_code == 404
        deleted = await send(api, "DELETE", project, params={"expected_revision": 0})
        assert deleted.status_code == 200, deleted.text
        await delivery.process_once()
        assert not jobs.folder(case.viewer, job_id).exists()
        assert (await jobs.load(case.viewer, job_id)).status == "cancelled"
