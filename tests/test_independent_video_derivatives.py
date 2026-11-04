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
from fpl_runtime.video_exports import OUTPUTS, output_peer
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


class DropOutputReply(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.outputs = []

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            request.url.host == "assets"
            and request.method == "POST"
            and request.url.path.startswith(OUTPUTS + "/")
            and response.status_code == 200
        ):
            self.outputs.append(request.url.path)
            if len(self.outputs) == 1:
                await response.aclose()
                raise httpx.ReadError("isolated Assets output receipt dropped", request=request)
        return response


async def test_video_rendering_lost_reply_owner_isolation_and_removal(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
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
    case.assets.state.video_output_peer = output_peer(ORIGINALS_KEY)
    publication = DropOutputReply(case.mesh)
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
            service="rendering", credential=RENDER_TOKEN, catalog=CATALOG, transport=publication
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

        # A still uses the visible image plus its text layer, both tied to revision 1.
        edited = await send(
            api,
            "POST",
            project + "/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "video-frame-edit",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "image-1",
                            "trackId": "mixed-1",
                            "kind": "image",
                            "name": "Image",
                            "assetId": asset["id"],
                            "durationUs": 1_000_000,
                            "timelineStartUs": 0,
                        },
                    },
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "title-1",
                            "trackId": "visual-1",
                            "kind": "text",
                            "name": "Title",
                            "text": "剪辑文字",
                            "durationUs": 1_000_000,
                            "timelineStartUs": 0,
                        },
                    },
                ],
            },
        )
        assert edited.status_code == 200, edited.text
        preview = project + "/preview/frame"
        parameters = {"revision": 1, "timeUs": 0, "width": 320}
        still = await send(api, "GET", preview, params=parameters)
        assert still.status_code == 200, still.text
        with Image.open(BytesIO(still.content)) as picture:
            assert picture.size == (320, 180)
        repeat = await send(api, "GET", preview, params=parameters)
        assert repeat.content == still.content
        stale = await send(api, "GET", preview, params={**parameters, "revision": 0})
        assert stale.status_code == 409
        text = await send(
            api,
            "GET",
            project + "/text-clips/title-1/layer",
            params={"revision": 1},
        )
        assert text.status_code == 200 and text.content.startswith(b"\x89PNG")
        active = rendering.state.identity.status
        validated = False

        async def revoke_before_output(**kwargs):
            nonlocal validated
            if validated:
                return False
            validated = True
            return await active(**kwargs)

        with monkeypatch.context() as fault:
            fault.setattr(rendering.state.identity, "status", revoke_before_output)
            revoked = await send(api, "GET", preview, params={**parameters, "width": 321})
        assert revoked.status_code == 401

        renders = project + "/renders"
        request = {"expectedRevision": 1, "preset": "720p30", "endUs": 100_000}
        preflight = await send(api, "POST", renders + "/preflight", json=request)
        assert preflight.status_code == 200 and preflight.json()["ready"], preflight.text
        job_request = {
            **request,
            "requestId": "video-export-fixture",
            "previewFingerprint": preflight.json()["fingerprint"],
        }
        submitted = await send(api, "POST", renders, json=job_request)
        assert submitted.status_code == 200, submitted.text
        submitted = submitted.json()
        task_id = submitted["id"]
        assert (await send(api, "POST", renders, json=job_request)).json()["id"] == task_id
        render_delivery = video.state.render_delivery
        await render_delivery.process_once()
        exports = rendering.state.video_exports
        await exports.process_once()
        sealed = await exports.load(case.viewer, task_id)
        assert sealed.status == "publishing", sealed.error
        with pytest.raises(CapabilityUnavailable):
            await exports.process_once()
        assert len(publication.outputs) == 1
        assert (await exports.load(case.viewer, task_id)).status == "publishing"
        await exports.recover()
        await exports.process_once()
        await render_delivery.process_once()
        assert len(publication.outputs) == 1
        finished = (await send(api, "GET", renders + "/" + task_id)).json()
        assert finished["status"] == "completed" and finished["progress"] == 100, finished
        assert finished["resultDetail"]["frameCount"] == 3
        assert finished["resultDetail"]["probe"]["durationUs"] == 100_000
        public_file = "/v1/files/" + finished["outputAssetId"] + "/download"
        headers = await authorize(case, "assets", "GET", public_file)
        movie = await internal.get("http://assets" + public_file, headers=headers)
        assert movie.status_code == 200 and b"ftyp" in movie.content[:16]
        assert (await send(api, "GET", files)).status_code == 200

        cancelled = await send(
            api, "POST", renders, json={**job_request, "requestId": "video-export-cancel"}
        )
        assert cancelled.status_code == 200, cancelled.text
        cancelled_id = cancelled.json()["id"]
        cancelled = await send(api, "POST", renders + "/" + cancelled_id + "/cancel")
        assert cancelled.json()["status"] == "cancelled"
        await render_delivery.process_once()
        assert await exports.load(case.viewer, cancelled_id) is None

        deleted = await send(api, "DELETE", project, params={"expected_revision": 0})
        assert deleted.status_code == 200, deleted.text
        await delivery.process_once()
        assert not jobs.folder(case.viewer, job_id).exists()
        assert (await jobs.load(case.viewer, job_id)).status == "cancelled"
