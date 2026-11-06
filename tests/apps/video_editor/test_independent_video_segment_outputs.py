"""Assets never publishes a partial group and replays the exact ordered receipt."""

import hashlib
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.video_editor.application import PROJECTS, create_app
from studio.contracts.video_editor.video_exports import output_peer
from studio.contracts.video_editor.video_segment_handoff import SegmentTarget, asset_peer
from studio.contracts.video_editor.video_segments import OUTPUTS, SegmentBatchManifest
from studio.runtime.database.migrations import apply
from studio.runtime.files.signed_payloads import ModelOutputDescription
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[3]


async def test_segment_batch_second_file_failure_and_replay(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "video"
    apply(state / "service.db", "video", MIGRATIONS)
    credential = "isolated-video-segments-credential"
    case.identity.state.identity_options["service_credentials"]["video"] = credential
    identity = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = identity
    peer = output_peer("isolated-render-segments-" * 4)
    case.assets.state.video_output_peer = peer
    app = create_app(
        state_root=state,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        schema_path=ROOT / "web/src/generated/openapi.json",
        credential=credential,
        transport=case.mesh,
        run_worker=False,
    )

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://video") as video,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=case.assets), base_url="http://assets"
        ) as assets,
    ):
        created = await video.post(
            PROJECTS,
            headers=await authorize(case, "video", "POST", PROJECTS),
            json={"title": "Segment settlement"},
        )
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        first = b"\x00\x00\x00\x18ftypmp42" + b"segment-1"
        second = b"\x00\x00\x00\x18ftypmp42" + b"segment-2"
        manifest = SegmentBatchManifest(
            files=tuple(
                ModelOutputDescription(
                    "duplicate.mp4", "video/mp4", len(raw), hashlib.sha256(raw).hexdigest()
                )
                for raw in (first, second)
            )
        )
        target = f"{OUTPUTS}/{project}/{uuid4()}/{manifest.digest}"
        send_headers = {
            **peer.headers("POST", target, case.viewer),
            "X-Fpl-Manifest-Length": str(len(manifest.encoded)),
        }

        async def receipt(owner=case.viewer):
            return await assets.get(target, headers=peer.headers("GET", target, owner))

        corrupted = manifest.encoded + first + second[:-1] + b"x"
        invalid = await assets.post(target, headers=send_headers, content=corrupted)
        assert invalid.status_code == 422 and invalid.json()["code"] == "output_changed"
        assert (await receipt()).status_code == 404
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            assert (
                list(
                    await db.scalars(
                        select(VisualAsset.id).where(VisualAsset.video_editor_project_id == project)
                    )
                )
                == []
            )

        valid = manifest.encoded + first + second
        accepted = await assets.post(target, headers=send_headers, content=valid)
        assert accepted.status_code == 200, accepted.text
        items = accepted.json()["items"]
        assert [item["sha256"] for item in items] == [
            file.content_sha256 for file in manifest.files
        ]
        assert len({item["asset"]["id"] for item in items}) == 2
        retry = await assets.post(target, headers=send_headers, content=valid)
        assert retry.status_code == 200 and retry.json() == accepted.json()
        assert (
            await assets.post(target, headers=send_headers, content=corrupted)
        ).status_code == 422
        assert (await receipt()).json() == accepted.json()
        assert (await receipt(case.owner)).status_code == 404

        # A Visual transfer may have persisted the first hidden file when a later
        # upload fails. Renderer can discard the incomplete stage with its exact scope.
        case.assets.state.visual_segment_assets_peer = asset_peer("visual-segment-fixture-" * 3)
        staged_manifest = SegmentBatchManifest(
            files=manifest.files,
            target=SegmentTarget(project_id=str(uuid4()), expected_revision=0),
            labels=("First", "Second"),
        )
        pending = f"{OUTPUTS}/{project}/{uuid4()}/{staged_manifest.digest}"
        partial = await assets.post(
            pending,
            headers={
                **peer.headers("POST", pending, case.viewer),
                "X-Fpl-Manifest-Length": str(len(staged_manifest.encoded)),
            },
            content=staged_manifest.encoded + first + second[:-1] + b"x",
        )
        assert partial.status_code == 422, partial.text
        lookup = await assets.get(pending, headers=peer.headers("GET", pending, case.viewer))
        assert lookup.status_code == 404
        for _ in range(2):
            discarded = await assets.delete(
                pending, headers=peer.headers("DELETE", pending, case.viewer)
            )
            assert discarded.json() == {"state": "discarded"}
        assert await case.assets.state.file_cleanup.run_once() == 1
    await identity.close()
