"""A sealed Video group fences the Visual canvas and recovers an unknown decision."""

import hashlib
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS as VIDEO_MIGRATIONS
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS as VISUAL_MIGRATIONS
from studio.assembly.independent.video_editor.application import PROJECTS
from studio.assembly.independent.video_editor.application import create_app as create_video
from studio.assembly.independent.visual_workshop.application import create_app as create_visual
from studio.contracts.video_editor.video_exports import EXPORTS, VideoExportReceipt, output_peer
from studio.contracts.video_editor.video_segment_handoff import (
    SegmentHandoff,
    SegmentTarget,
    asset_peer,
)
from studio.contracts.video_editor.video_segments import OUTPUTS, SegmentBatchManifest
from studio.runtime.database.migrations import apply
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityUnavailable
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[3]
VISUAL_PROJECTS = "/v1/visual-workshop/projects"


class HandoffFaults(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.fault = None

    async def handle_async_request(self, request):
        if request.url.host != "visual" or not request.url.path.endswith("/commit"):
            return await self.mesh.handle_async_request(request)
        if self.fault == "before":
            self.fault = None
            raise httpx.ReadError("isolated lost handoff request", request=request)
        reply = await self.mesh.handle_async_request(request)
        if self.fault == "after" and reply.status_code == 200:
            self.fault = None
            await reply.aclose()
            raise httpx.ReadError("isolated lost handoff receipt", request=request)
        return reply


async def test_video_visual_handoff_replays_and_refuses_stale_canvas(scenario, tmp_path):  # noqa: F811
    case = scenario
    credentials = case.identity.state.identity_options["service_credentials"]
    credentials.update(visual="visual-test-credential-" * 3, video="video-test-credential-" * 3)
    identity = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = identity
    output = output_peer("rendering-output-test-" * 3)
    case.assets.state.video_output_peer = output
    visual_key, assets_key = "video-visual-test-" * 3, "visual-assets-test-" * 3
    case.assets.state.visual_segment_assets_peer = asset_peer(assets_key)
    video_root, visual_root = tmp_path / "video", tmp_path / "visual"
    apply(video_root / "service.db", "video", VIDEO_MIGRATIONS)
    apply(visual_root / "service.db", "visual", VISUAL_MIGRATIONS)
    faults = HandoffFaults(case.mesh)
    visual = create_visual(
        state_root=visual_root,
        public_key=case.key.public_key(),
        credential=credentials["visual"],
        catalog=CATALOG,
        transport=case.mesh,
        run_worker=False,
        video_segment_key=visual_key,
        segment_assets_key=assets_key,
    )
    video = create_video(
        state_root=video_root,
        public_key=case.key.public_key(),
        credential=credentials["video"],
        catalog=CATALOG,
        schema_path=ROOT / "web/src/generated/openapi.json",
        transport=faults,
        run_worker=False,
        media_key="video-rendering-test-" * 3,
        segment_visual_key=visual_key,
    )
    rendering = FastAPI()
    receipts = {}

    @rendering.get(EXPORTS + "/{task_id}")
    async def status(task_id: str):
        return receipts[task_id]

    case.mesh.apps.update(visual=visual, rendering=rendering)

    async def send(api, service, method, path, **kwargs):
        return await api.request(
            method, path, headers=await authorize(case, service, method, path), **kwargs
        )

    async with (
        visual.router.lifespan_context(visual),
        video.router.lifespan_context(video),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=video), base_url="http://video") as api,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=visual), base_url="http://visual"
        ) as destination,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=case.assets), base_url="http://assets"
        ) as assets,
    ):
        created = await send(api, "video", "POST", PROJECTS, json={"title": "Video source"})
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        root = f"{PROJECTS}/{project}"
        source = b"\x00\x00\x00\x18ftypmp42synthetic"
        upload = await send(
            api,
            "video",
            "POST",
            root + "/assets",
            files={"upload": ("source.mp4", source, "video/mp4")},
        )
        assert upload.status_code == 200, upload.text
        source_id = upload.json()["id"]
        fingerprint = hashlib.sha256(source).hexdigest()
        async with video.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            metadata = await db.get(VideoEditorAssetMetadata, source_id)
            metadata.processing_status = "ready"  # Isolated fixture in place of an FFmpeg probe.
            metadata.fingerprint = fingerprint
            metadata.probe = {"durationUs": 1_000_000}
            await db.commit()

        operation = await send(
            api,
            "video",
            "POST",
            root + "/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "handoff-timeline",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "source-clip",
                            "trackId": "visual-1",
                            "kind": "video",
                            "name": "Source",
                            "durationUs": 500_000,
                            "timelineStartUs": 0,
                            "assetId": source_id,
                        },
                    }
                ],
            },
        )
        assert operation.status_code == 200, operation.text
        created = await send(
            destination,
            "visual",
            "POST",
            VISUAL_PROJECTS,
            json={
                "title": "Existing Canvas",
                "kind": "canvas",
            },
        )
        assert created.status_code == 200, created.text
        target = created.json()["id"]
        canvas = f"{VISUAL_PROJECTS}/{target}/canvas"
        await visual.state.reference_delivery.process_once()

        async def create_group(request_id, revision):
            response = await send(
                api,
                "video",
                "POST",
                root + "/segment-exports",
                json={
                    "expectedRevision": 1,
                    "requestId": request_id,
                    "target": {"projectId": target},
                    "segments": [{"clipId": "source-clip", "name": "Delivered"}],
                },
            )
            assert response.status_code == 200, response.text
            task = response.json()
            assert task["resultDetail"]["targetCanvasRevision"] == revision
            plan = SegmentTarget(project_id=target, expected_revision=revision)
            manifest = SegmentBatchManifest(
                files=(
                    ModelOutputDescription("delivered.mp4", "video/mp4", len(source), fingerprint),
                ),
                target=plan,
                labels=("Delivered",),
            )
            path = f"{OUTPUTS}/{project}/{task['id']}/{manifest.digest}"
            staged = await assets.post(
                path,
                headers={
                    **output.headers("POST", path, case.viewer),
                    "X-Fpl-Manifest-Length": str(len(manifest.encoded)),
                },
                content=manifest.encoded + source,
            )
            assert staged.status_code == 200, staged.text
            item = staged.json()["items"][0]
            receipts[task["id"]] = VideoExportReceipt(
                status="completed",
                progress=100,
                segments=[{**item, "probe": {"durationUs": 500_000}}],
                handoff=SegmentHandoff(
                    source_project_id=project,
                    task_id=task["id"],
                    manifest_sha256=manifest.digest,
                    target=plan,
                ),
            )
            return task["id"], item["asset"]["id"]

        task, asset = await create_group("handoff-recovery", 0)
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            assert await db.get(VisualAsset, asset) is None
        delivery = video.state.render_delivery
        faults.fault = "before"
        with pytest.raises(CapabilityUnavailable):
            await delivery.process_once()
        old_canvas = await send(destination, "visual", "GET", canvas)
        assert old_canvas.json()["nodes"] == []
        blocked = await send(
            destination,
            "visual",
            "PUT",
            canvas,
            json={
                "expected_revision": 0,
                "nodes": [],
            },
        )
        assert blocked.status_code == 409 and blocked.json()["code"] == "segment_target_reserved"
        faults.fault = "after"
        with pytest.raises(CapabilityUnavailable):
            await delivery.process_once()
        await delivery.process_once()
        await delivery.process_once()
        readback = await send(destination, "visual", "GET", canvas)
        assert readback.json()["revision"] == 1
        assert [node["asset_id"] for node in readback.json()["nodes"]] == [asset]
        completed = await send(api, "video", "GET", root + "/segment-exports/" + task)
        assert completed.json()["status"] == "completed"
        assert completed.json()["resultDetail"]["targetProjectId"] == target

        stale_task, hidden = await create_group("handoff-stale", 1)
        edited = await send(
            destination,
            "visual",
            "PUT",
            canvas,
            json={
                "expected_revision": 1,
                "nodes": readback.json()["nodes"],
            },
        )
        assert edited.status_code == 200, edited.text
        await delivery.process_once()
        stale = await send(api, "video", "GET", root + "/segment-exports/" + stale_task)
        assert stale.json()["status"] == "failed"
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            ids = list(
                await db.scalars(select(VisualAsset.id).where(VisualAsset.id.in_((asset, hidden))))
            )
            assert ids == [asset]
        assert (await send(destination, "visual", "GET", canvas)).json()["revision"] == 2
    await identity.close()
