"""Verify real frame sampling, atomic evidence and lost receipt recovery."""

import io
import json
import subprocess
from uuid import uuid4

import httpx
import pytest
from PIL import Image
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize
from tests.test_visual_compositions_service import Faults

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.media_rendering.settings import RenderingSettings
from studio.apps.media_rendering.storage.migrations.registry import (
    MIGRATIONS as RENDERING_MIGRATIONS,
)
from studio.apps.visual_workshop.acceptance.models import AcceptanceRun, AcceptanceStandardVersion
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS as VISUAL_MIGRATIONS
from studio.assembly.independent.media_rendering.application import create_app as create_rendering
from studio.assembly.independent.visual_workshop.application import create_app as create_visual
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_samples import (
    ASSET_PURPOSE,
    FRAMES_HEADER,
    INPUT_HEADER,
    MEDIA_HEADER,
    RENDER_PURPOSE,
    SampleAssetQuery,
    SamplePlan,
)
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient, CapabilityDenied

PROJECTS = "/v1/visual-workshop/projects"


async def test_native_video_samples_are_scoped_and_resume_publication(scenario, tmp_path):  # noqa: F811
    case = scenario
    key = "isolated-visual-sample-rendering-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        visual=CREDENTIALS["visual"],
        rendering=key,
    )
    for service, migrations in (("visual", VISUAL_MIGRATIONS), ("rendering", RENDERING_MIGRATIONS)):
        apply(tmp_path / service / "service.db", service, migrations)
    transport = Faults(case.mesh)
    visual = create_visual(
        state_root=tmp_path / "visual",
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["visual"],
        transport=transport,
        run_worker=False,
    )
    render = create_rendering(
        settings=RenderingSettings(tmp_path / "rendering" / "service.db"),
        public_key=case.key.public_key(),
        catalog=CATALOG,
        identity=LiveAuthorization(service="rendering", credential=key, transport=case.mesh),
        capabilities=CapabilityClient(
            service="rendering", credential=key, catalog=CATALOG, transport=case.mesh
        ),
        run_worker=False,
    )
    case.mesh.apps.update(visual=visual, rendering=render)
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    case.assets.state.capabilities = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )
    movie = tmp_path / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=red:s=96x64:r=8:d=1.5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(movie),
        ],
        check=True,
        timeout=20,
        capture_output=True,
    )

    async with (
        live.client,
        visual.router.lifespan_context(visual),
        render.router.lifespan_context(render),
        httpx.AsyncClient(transport=case.mesh) as http,
    ):

        async def send(method, path, *, service="visual", **kwargs):
            return await http.request(
                method,
                f"http://{service}" + path,
                headers=await authorize(case, service, method, path),
                **kwargs,
            )

        created = await send("POST", PROJECTS, json={"title": "Evidence fixture", "kind": "canvas"})
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        root = f"{PROJECTS}/{project}"
        await visual.state.reference_delivery.process_once()
        asset = await send(
            "POST",
            "/v1/files",
            service="assets",
            data={"project_id": project},
            files={"upload": ("sample.mp4", movie.read_bytes(), "video/mp4")},
        )
        assert asset.status_code == 200, asset.text
        source = asset.json()["id"]
        saved = await send(
            "PUT",
            root + "/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {
                        "id": "output-video",
                        "kind": "video",
                        "title": "Sample",
                        "position": {"x": 0, "y": 0},
                    }
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        output_path = root + "/nodes/output-video/outputs"
        saved = await send("POST", output_path, json={"expected_revision": 1, "asset_id": source})
        assert saved.status_code == 200, saved.text
        await visual.state.reference_delivery.process_once()
        output = (await send("GET", output_path)).json()["items"][0]
        run = await seed_review(visual, case.viewer, project, output)
        review = root + "/acceptance/runs/" + run
        sample = review + "/samples"
        await check_baseline(http, case, visual.state.capabilities, root, run, source, sample)
        body = {"expected_revision": 0, "start_ms": 0, "end_ms": 650}
        assert (await send("POST", sample, json={**body, "end_ms": 1600})).status_code == 422
        assert (
            await send("POST", sample.replace(run, "another-run"), json=body)
        ).status_code == 404
        transport.drop_commit = True
        reply = await send("POST", sample, json=body)
        assert reply.status_code == 503, reply.text
        assert not transport.drop_commit
        await visual.state.reference_delivery.process_once()
        current = (await send("GET", review)).json()
        first = current["evidence"]
        assert current["revision"] == 1 and current["decision"] == "pending"
        assert 1 < len(first) < 12
        assert {item["source_asset_id"] for item in first} == {source}
        times = [item["position_ms"] for item in first]
        assert times == sorted(set(times))
        original = await send("GET", f"/v1/files/{first[0]['asset_id']}/content", service="assets")
        assert original.status_code == 200
        with Image.open(io.BytesIO(original.content)) as frame:
            assert frame.format == "PNG" and frame.width == 96
            red, green, blue = frame.convert("RGB").getpixel((12, 12))
            assert red >= 250 and green <= 5 and blue <= 5
        stale = await send("POST", sample, json=body)
        assert stale.status_code == 409 and stale.json()["current"]["evidence"] == first
        second = await send(
            "POST",
            sample,
            json={
                "expected_revision": 1,
                "start_ms": 750,
                "end_ms": 1200,
            },
        )
        assert second.status_code == 200, second.text
        assert second.json()["revision"] == 2
        assert second.json()["evidence"][: len(first)] == first
        assert len(second.json()["evidence"]) > len(first)
        deletion = await send("DELETE", root, params={"expected_revision": 0})
        assert deletion.status_code == 200, deletion.text
        for item in (first[0], second.json()["evidence"][-1]):
            evidence = await send("GET", f"/v1/files/{item['asset_id']}/content", service="assets")
            assert evidence.status_code == 404


async def seed_review(visual, owner, project, output):
    version, run = str(uuid4()), str(uuid4())
    async with visual.state.database.sessions(info={"owner_user_id": owner}) as db:
        db.add(
            AcceptanceStandardVersion(
                id=version,
                owner_user_id=owner,
                project_id=project,
                version=1,
                document={"title": "Fixture", "criteria": [], "node_ids": [output["node_id"]]},
            )
        )
        await db.flush()
        db.add(
            AcceptanceRun(
                id=run,
                owner_user_id=owner,
                project_id=project,
                node_id=output["node_id"],
                output_id=output["id"],
                standard_id=version,
                request_id=str(uuid4()),
                fingerprint="a" * 64,
                status="completed",
                scheme_id="motion-transfer:api",
                snapshot={
                    "standard_version": 1,
                    "standard_title": "Fixture",
                    "criteria": [],
                    "coverage": "Sample fixture",
                    "metadata": {"duration_ms": 1500},
                    "output": {
                        "id": output["id"],
                        "kind": "video",
                        "version": output["version"],
                        "asset_id": output["asset_id"],
                        "text": None,
                        "title": "Sample",
                    },
                },
            )
        )
        await db.commit()
    return run


async def check_baseline(http, case, peer, root, run, source, sample):
    project = root.rsplit("/", 1)[1]
    start = root + "/nodes/output-video/acceptance/runs"
    original = (await authorize(case, "visual", "POST", start))[HEADER]

    async def grant(purpose, service, target):
        return await peer.authorize_request(
            original, RequestGrant("visual", purpose, "POST", start, service, "POST", target)
        )

    query = SampleAssetQuery(asset_ids=[source])
    metadata = query.path(project, run)
    token = await grant(ASSET_PURPOSE, "assets", metadata)
    reply = await http.post(
        "http://assets" + metadata, headers={HEADER: token}, json=query.model_dump()
    )
    assert reply.status_code == 200, reply.text
    for mode, expected in (
        ("review-output", list(range(0, 1500, 125))),
        ("review-reference", [0, 750]),
    ):
        plan = SamplePlan(source=reply.json(), mode=mode)
        target = plan.path(project, run)
        input_token = await grant(ASSET_PURPOSE, "assets", plan.scope.path(project, run))
        token = await grant(RENDER_PURPOSE, "rendering", target)
        rendered = await http.post(
            "http://rendering" + target,
            headers={HEADER: token, INPUT_HEADER: input_token},
            json=plan.model_dump(),
        )
        assert rendered.status_code == 200, rendered.text
        assert json.loads(rendered.headers[MEDIA_HEADER]) == {
            "width": 96,
            "height": 64,
            "duration_ms": 1500,
            "has_audio": False,
        }
        times = [frame["position_ms"] for frame in json.loads(rendered.headers[FRAMES_HEADER])]
        assert times == expected
    manual_token = (await authorize(case, "visual", "POST", sample))[HEADER]
    with pytest.raises(CapabilityDenied) as wrong_source:
        await peer.authorize_request(
            manual_token,
            RequestGrant("visual", RENDER_PURPOSE, "POST", sample, "rendering", "POST", target),
        )
    assert wrong_source.value.status == 403
