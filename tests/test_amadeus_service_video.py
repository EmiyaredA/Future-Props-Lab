"""An approved timeline batch preserves Video's own CAS and operation results."""

from pathlib import Path

import httpx
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_amadeus.application import create_app as create_amadeus
from fpl_amadeus.migrations.registry import MIGRATIONS as AMADEUS
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_video.application import PROJECTS
from fpl_video.application import create_app as create_video
from fpl_video.migrations.registry import MIGRATIONS as VIDEO


async def test_video_batch_receipt_and_stale_revision_are_mapped_to_approved_action(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    video_root, amadeus_root = tmp_path / "video", tmp_path / "amadeus"
    for service, root, migrations in (
        ("video", video_root, VIDEO),
        ("amadeus", amadeus_root, AMADEUS),
    ):
        root.mkdir()
        apply(root / "service.db", service, migrations)
    tokens = {service: "isolated-video-action-" + service * 5 for service in ("amadeus", "video")}
    case.identity.state.identity_options["service_credentials"].update(tokens)
    assets = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = assets
    video = create_video(
        state_root=video_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        schema_path=Path("web/src/generated/openapi.json"),
        credential=tokens["video"],
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["video"] = video
    amadeus = create_amadeus(
        state_root=amadeus_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=tokens["amadeus"],
        transport=case.mesh,
    )
    async with (
        assets.client,
        video.router.lifespan_context(video),
        amadeus.router.lifespan_context(amadeus),
        httpx.AsyncClient(transport=case.mesh, base_url="http://video") as editor,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=amadeus), base_url="http://amadeus"
        ) as api,
    ):
        project = await editor.post(
            PROJECTS,
            json={"title": "Owned timeline"},
            headers=await authorize(case, "video", "POST", PROJECTS),
        )
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]
        base = "/v1/amadeus/conversations"

        async def send(path, **kwargs):
            return await api.post(
                path, headers=await authorize(case, "amadeus", "POST", path), **kwargs
            )

        root = f"{base}/{(await send(base)).json()['id']}/actions"
        for title, status in (("Approved", "completed"), ("Stale", "failed")):
            proposed = await send(
                root,
                json={
                    "tool_name": "video_timeline_batch",
                    "arguments": {
                        "project_id": project_id,
                        "expected_revision": 0,
                        "operations": [
                            {"type": "updateTrack", "trackId": "visual-1", "patch": {"name": title}}
                        ],
                    },
                },
            )
            assert proposed.status_code == 200, proposed.text
            action = f"{root}/{proposed.json()['id']}"
            approved = await send(
                action + "/decision",
                json={"approve": True, "arguments_sha256": proposed.json()["arguments_sha256"]},
            )
            assert approved.status_code == 200, approved.text
            result = (await send(action + "/execute")).json()
            assert result["status"] == status, result
            data = result["result"]
            if status == "completed":
                assert data["revision"] == 1
                assert data["operationResults"][0]["status"] == "completed"
            else:
                assert data["code"] == "revision_conflict"
                assert data["current"]["revision"] == 1
                assert data["operationResults"][0]["status"] == "not_executed"
