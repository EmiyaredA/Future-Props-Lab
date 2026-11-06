"""Motion and Rendering recover one job across lost responses and restarts."""

import asyncio
import zipfile
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.media_rendering.settings import RenderingSettings
from studio.apps.media_rendering.storage.migrations.registry import (
    MIGRATIONS as RENDERING_MIGRATIONS,
)
from studio.apps.motion_compositor.storage.migrations.registry import MIGRATIONS
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS as VIDEO_MIGRATIONS
from studio.assembly.independent.media_rendering.application import create_app as rendering_app
from studio.assembly.independent.motion_compositor.application import PROJECTS, create_app
from studio.assembly.independent.video_editor.application import PROJECTS as VIDEO_PROJECTS
from studio.assembly.independent.video_editor.application import create_app as video_app
from studio.contracts.motion_compositor.motion_exports import PREFIX, ExportPeer, render_target
from studio.contracts.video_editor.video_exports import output_peer
from studio.contracts.video_editor.video_handoff import HANDOFFS
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient, CapabilityUnavailable
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[3]
MOTION_TOKEN = "motion-test-identity-client-credential"
RENDER_TOKEN = "render-test-identity-client-credential"
PEER_KEY = "motion-render-test-unique-peer-control-key"
VIDEO_TOKEN = "motion-video-test-identity-client-credential"
VIDEO_MEDIA = "motion-video-test-render-media-peer-key"
VIDEO_ORIGINALS = "motion-video-test-assets-originals-peer-key"


class LostSubmit(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.lost = False
        self.submissions = []
        self.dropped_handoff = False

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if request.url.host == "rendering" and render_target(request.method, request.url.path):
            self.submissions.append((request.url.path, response.status_code))
            if response.status_code == 200 and not self.lost:
                self.lost = True
                await response.aclose()
                raise httpx.ReadError("submission reply dropped", request=request)
        if (
            not self.dropped_handoff
            and request.url.host == "video"
            and request.method == "POST"
            and request.url.path.startswith(HANDOFFS + "/")
            and response.status_code == 200
        ):
            self.dropped_handoff = True
            await response.aclose()
            raise httpx.ReadError("handoff reply dropped", request=request)
        return response


@pytest.fixture
async def split(scenario, tmp_path):  # noqa: F811
    case = scenario
    case.identity.state.identity_options["service_credentials"].update(
        motion=MOTION_TOKEN, rendering=RENDER_TOKEN, video=VIDEO_TOKEN
    )
    motion_root, render_root = tmp_path / "motion", tmp_path / "rendering"
    apply(motion_root / "service.db", "motion", MIGRATIONS)
    render_db = render_root / "service.db"
    video_root = tmp_path / "video"
    apply(video_root / "service.db", "video", VIDEO_MIGRATIONS)
    apply(render_db, "rendering", RENDERING_MIGRATIONS)
    lost = LostSubmit(case.mesh)
    assets_identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.identity = assets_identity
    case.assets.state.video_output_peer = output_peer(VIDEO_ORIGINALS)

    def motion():
        return create_app(
            state_root=motion_root,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            credential=MOTION_TOKEN,
            schema_path=ROOT / "web/src/generated/openapi.json",
            transport=lost,
            run_worker=False,
            export_key=PEER_KEY,
        )

    def renderer():
        app = rendering_app(
            settings=RenderingSettings(render_db),
            public_key=case.key.public_key(),
            catalog=CATALOG,
            identity=LiveAuthorization(
                service="rendering", credential=RENDER_TOKEN, transport=case.mesh
            ),
            capabilities=CapabilityClient(
                service="rendering", credential=RENDER_TOKEN, catalog=CATALOG, transport=case.mesh
            ),
            run_worker=False,
            export_key=PEER_KEY,
            video_media_key=VIDEO_MEDIA,
            video_originals_key=VIDEO_ORIGINALS,
        )
        case.mesh.apps["rendering"] = app
        return app

    def video():
        app = video_app(
            state_root=video_root,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
            credential=VIDEO_TOKEN,
            transport=case.mesh,
            run_worker=False,
            media_key=VIDEO_MEDIA,
        )
        case.mesh.apps["video"] = app
        return app

    async with assets_identity.client:
        yield case, motion, renderer, lost, video


async def api(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://motion")


async def call(case, client, method, path, **kwargs):
    headers = await authorize(case, "motion", method, path)
    headers.update(kwargs.pop("headers", {}))
    return await client.request(method, path, headers=headers, **kwargs)


async def project_with_image(case, client):
    created = await call(case, client, "POST", PROJECTS, json={"title": "Motion export"})
    assert created.status_code == 200, created.text
    project = PROJECTS + "/" + created.json()["id"]
    image = BytesIO()
    Image.new("RGB", (4, 4), "green").save(image, format="PNG")
    uploaded = await call(
        case,
        client,
        "POST",
        project + "/assets",
        files={"file": ("shape.png", image.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    result = await call(
        case,
        client,
        "POST",
        project + "/document/operations",
        json={
            "expectedRevision": 0,
            "requestId": "export-test-document",
            "operations": [
                {
                    "type": "addLayer",
                    "layer": {
                        "id": "shape",
                        "name": "Shape",
                        "kind": "image",
                        "assetId": uploaded.json()["id"],
                    },
                }
            ],
        },
    )
    assert result.status_code == 200, result.text
    return project


async def create_export(case, client, path, request_id="export-test-task"):
    payload = {
        "expectedRevision": 1,
        "requestId": request_id,
        "startFrame": 0,
        "endFrame": 2,
        "formats": ["mp4", "mov4444", "png-sequence"],
    }
    result = await call(case, client, "POST", path, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "queued"
    replay = await call(case, client, "POST", path, json=payload)
    assert replay.json() == result.json()
    conflict = await call(case, client, "POST", path, json={**payload, "endFrame": 3})
    assert conflict.status_code == 422
    return path + "/" + result.json()["id"]


async def test_motion_export_lost_ack_restart_outputs_and_project_cleanup(split, monkeypatch):
    case, motion, renderer, lost, _video = split
    first = motion()
    render_first = renderer()
    async with (
        first.router.lifespan_context(first),
        render_first.router.lifespan_context(render_first),
        await api(first) as client,
    ):
        project = await project_with_image(case, client)
        export = await create_export(case, client, project + "/exports")
        with pytest.raises(CapabilityUnavailable):
            await first.state.motion_export_delivery.process_once()
        assert lost.lost
        job_id = render_target("POST", lost.submissions[0][0])[2]
        jobs = render_first.state.motion_jobs
        job = await jobs.load(case.viewer, job_id)
        assert job.status == "queued"
        assert await jobs.load(case.owner, job_id) is None

        async def interrupted(*_args, **_kwargs):
            raise asyncio.CancelledError

        with monkeypatch.context() as fault:
            fault.setattr("studio.apps.media_rendering.motion_jobs.render_outputs", interrupted)
            with pytest.raises(asyncio.CancelledError):
                await jobs.process_once()
        assert (await jobs.load(case.viewer, job_id)).status == "running"

    second = motion()
    render_second = renderer()
    async with (
        second.router.lifespan_context(second),
        render_second.router.lifespan_context(render_second),
        await api(second) as client,
    ):
        jobs = render_second.state.motion_jobs
        await jobs.recover()
        await jobs.process_once()
        await second.state.motion_export_delivery.process_once()
        task = (await call(case, client, "GET", export)).json()
        assert task["status"] == "completed", task
        assert task["progress"] == 100
        assert len(lost.submissions) == 1
        for name, magic in (("mp4", b"ftyp"), ("mov4444", b"ftyp"), ("png-sequence", b"PK")):
            file = await call(case, client, "GET", task["outputs"][name])
            assert file.status_code == 200, file.text
            assert magic in file.content[:16]
            part = await call(
                case, client, "GET", task["outputs"][name], headers={"Range": "bytes=0-7"}
            )
            assert part.status_code == 206 and part.content == file.content[:8]
            if name == "png-sequence":
                with zipfile.ZipFile(BytesIO(file.content)) as archive:
                    assert archive.namelist() == ["alpha-000000.png", "alpha-000001.png"]
                    with Image.open(BytesIO(archive.read(archive.namelist()[0]))) as image:
                        assert image.getpixel((0, 0))[:3] == (0, 128, 0)
        path = f"{PREFIX}/{job_id}/download/mp4"
        async with httpx.AsyncClient(transport=case.mesh) as internal:
            assert (await internal.get("http://rendering" + path)).status_code == 403
            assert (
                await internal.get(
                    "http://rendering" + path,
                    headers=ExportPeer(PEER_KEY).headers("GET", path, case.owner),
                )
            ).status_code == 404
        removed = await call(case, client, "DELETE", project, params={"expectedRevision": 0})
        assert removed.status_code == 200, removed.text
        await second.state.motion_export_delivery.process_once()
        assert not jobs.folder(case.viewer, job_id).exists()
        assert (await jobs.load(case.viewer, job_id)).payload == {}


async def test_motion_export_cancellation_and_revocation_publish_no_files(split):
    case, motion, renderer, lost, _video = split
    app, render = motion(), renderer()
    lost.lost = True
    async with (
        app.router.lifespan_context(app),
        render.router.lifespan_context(render),
        await api(app) as client,
    ):
        project = await project_with_image(case, client)
        exports = project + "/exports"
        queued = await create_export(case, client, exports)
        cancelled = await call(case, client, "POST", queued + "/cancel")
        assert cancelled.json()["status"] == "cancelled"
        delivery = app.state.motion_export_delivery
        await delivery.process_once()
        assert not lost.submissions

        revoked = await create_export(case, client, exports, request_id="export-test-revoked")
        await delivery.process_once()
        job_id = render_target("POST", lost.submissions[0][0])[2]
        status_headers = await authorize(case, "motion", "GET", revoked)
        logout = await case.browser.post(
            "/v1/auth/logout",
            headers={"X-CSRF-Token": case.csrf, "Origin": "http://127.0.0.1:19000"},
        )
        assert logout.status_code == 204
        jobs = render.state.motion_jobs
        await jobs.process_once()
        await delivery.process_once()
        status = await client.get(revoked, headers=status_headers)
        assert status.status_code == 200
        assert status.json()["status"] == "cancelled" and status.json()["outputs"] == {}
        assert not jobs.folder(case.viewer, job_id).exists()


async def test_motion_handoff_preserves_original_movies_and_recovers_lost_reply(split):
    case, motion, renderer, lost, video = split
    app, render, editor = motion(), renderer(), video()
    lost.lost = True
    async with (
        app.router.lifespan_context(app),
        render.router.lifespan_context(render),
        editor.router.lifespan_context(editor),
        await api(app) as client,
        httpx.AsyncClient(transport=case.mesh) as mesh,
    ):
        project = await project_with_image(case, client)
        task = await create_export(case, client, project + "/exports")
        delivery = app.state.motion_export_delivery
        await delivery.process_once()
        await render.state.motion_jobs.process_once()
        await delivery.process_once()
        completed = (await call(case, client, "GET", task)).json()
        assert completed["status"] == "completed"

        async def video_call(method, path, **kwargs):
            headers = await authorize(case, "video", method, path)
            return await mesh.request(method, "http://video" + path, headers=headers, **kwargs)

        existing = await video_call("POST", VIDEO_PROJECTS, json={"title": "Existing Video"})
        assert existing.status_code == 200, existing.text
        selected = existing.json()["id"]
        endpoint = task + "/video-editor-handoffs"
        destinations = [
            ("mp4", {"targetProjectId": selected}, "Existing Video"),
            ("mov4444", {"newProjectTitle": "New Motion Cut"}, "New Motion Cut"),
        ]
        for format_name, destination, title in destinations:
            original = await call(case, client, "GET", completed["outputs"][format_name])
            handed = await call(
                case, client, "POST", endpoint, json={**destination, "format": format_name}
            )
            assert handed.status_code == 200, handed.text
            receipt = handed.json()
            if format_name == "mp4":
                assert receipt["projectId"] == selected and lost.dropped_handoff
            root = f"{VIDEO_PROJECTS}/{receipt['projectId']}"
            project_row = (await video_call("GET", root)).json()
            assert project_row["title"] == title
            timeline = (await video_call("GET", root + "/timeline")).json()
            assert timeline["revision"] == 1
            top = min(timeline["document"]["tracks"], key=lambda track: track["order"])
            assert top["order"] == 0 and len(top["clips"]) == 1
            clip = top["clips"][0]
            assert clip["assetId"] == receipt["assetId"]
            assert clip["durationUs"] == 66_667
            copied_path = f"/v1/files/{receipt['assetId']}/download"
            headers = await authorize(case, "assets", "GET", copied_path)
            copied = await mesh.get("http://assets" + copied_path, headers=headers)
            assert copied.status_code == 200 and copied.content == original.content
