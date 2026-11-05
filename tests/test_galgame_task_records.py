"""Exercise owned Galgame job history and cancellation via published operations."""

import io

import httpx
from starlette.datastructures import UploadFile
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize

from app.apps.galgame_workshop.models import (
    GalgameAnnotationImportTask,
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from app.capabilities.asset_store.library import AssetLibrary
from fpl_assets.references import AssetReferences
from fpl_galgame.application import create_app
from fpl_galgame.migrations.registry import MIGRATIONS
from fpl_runtime.asset_references import ReferenceUpdate
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply

BASE = "/v1/galgame-workshop/projects"


async def seed_jobs(app, case):
    for owner, name in ((case.viewer, "own"), (case.owner, "foreign")):
        async with app.state.database.sessions(info={"owner_user_id": owner}) as db:
            db.add(GalgameWorkshopProject(id=name, title=name))
            await db.flush()
            snapshot = GalgameStorySnapshot(
                id=f"{name}-snapshot",
                project_id=name,
                story_revision=6,
                document={},
                reason="fixture",
            )
            db.add(snapshot)
            await db.flush()
            task = {
                "project_id": name,
                "story_revision": 6,
                "snapshot_id": snapshot.id,
                "request_payload": {},
            }
            db.add_all(
                [
                    GalgameVideoExportTask(
                        id=f"{name}-export", request_id="export", status="queued", **task
                    ),
                    GalgameVideoEditorHandoffTask(
                        id=f"{name}-handoff",
                        request_id="handoff",
                        status="running",
                        progress=24,
                        result_detail={"trackCount": 3},
                        **task,
                    ),
                    GalgameAnnotationImportTask(
                        id=f"{name}-import",
                        project_id=name,
                        source_project_id=f"{name}-annotation",
                        request_id="import",
                        status="completed",
                        expected_source_revision=2,
                        expected_story_revision=5,
                        request_payload={},
                        result_detail={"imported": 2},
                    ),
                ]
            )
            await db.commit()


async def test_galgame_job_reads_and_cancellation_keep_their_project_boundary(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    apply(tmp_path / "service.db", "galgame", MIGRATIONS)
    app = create_app(
        state_root=tmp_path,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["galgame"],
        transport=case.mesh,
        run_worker=False,
    )
    await seed_jobs(app, case)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://galgame"
        ) as http,
    ):

        async def request(method, path):
            full = BASE + path
            return await http.request(
                method, full, headers=await authorize(case, "galgame", method, full)
            )

        history = await request("GET", "/own/video-exports")
        assert history.status_code == 200, history.text
        original = history.json()["items"][0]
        assert original["id"] == "own-export" and original["storyRevision"] == 6
        assert (await request("GET", "/own/video-exports/own-export")).json() == original
        assert (await request("GET", "/foreign/video-exports")).status_code == 404
        assert (await request("GET", "/own/video-exports/foreign-export")).status_code == 404
        cancelled = await request("POST", "/own/video-exports/own-export/cancel")
        assert cancelled.status_code == 200, cancelled.text
        task = cancelled.json()
        assert task["status"] == task["phase"] == "cancelled" and task["revision"] == 1
        assert task["cancelRequested"] and task["finishedAt"]
        assert (await request("POST", "/own/video-exports/own-export/cancel")).json() == task

        history = await request("GET", "/own/video-editor-handoffs")
        assert history.status_code == 200, history.text
        original = history.json()["items"][0]
        assert original["id"] == "own-handoff" and original["trackCount"] == 3
        assert (await request("GET", "/own/video-editor-handoffs/own-handoff")).json() == original
        denied = await request("POST", "/own/video-editor-handoffs/foreign-handoff/cancel")
        assert denied.status_code == 404
        stopping = await request("POST", "/own/video-editor-handoffs/own-handoff/cancel")
        assert stopping.status_code == 200, stopping.text
        assert stopping.json()["status"] == "running" and stopping.json()["revision"] == 1

        imported = await request("GET", "/own/annotation-imports/own-import")
        assert imported.status_code == 200, imported.text
        assert imported.json()["result"] == {"imported": 2}
        assert imported.json()["sourceProjectId"] == "own-annotation"
        assert (await request("GET", "/own/annotation-imports/foreign-import")).status_code == 404


async def test_galgame_export_download_preserves_bytes_and_ranges(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    case.identity.state.identity_options["service_credentials"]["galgame"] = CREDENTIALS["galgame"]
    apply(tmp_path / "service.db", "galgame", MIGRATIONS)
    app = create_app(
        state_root=tmp_path,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["galgame"],
        transport=case.mesh,
        run_worker=False,
    )
    await seed_jobs(app, case)
    assets = case.assets.state
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    assets.identity = live
    movie = b"\x00\x00\x00\x18ftypmp42" + bytes(range(72))
    async with assets.database.sessions(info={"owner_user_id": case.viewer}) as db:
        library = AssetLibrary(db, assets.settings)
        owned = await library.store_upload(
            UploadFile(io.BytesIO(movie), filename="retained-export.mp4"),
            owner_user_id=case.viewer,
            galgame_project_id="own",
        )
        elsewhere = await library.store_upload(
            UploadFile(io.BytesIO(movie), filename="elsewhere.mp4"),
            owner_user_id=case.viewer,
            galgame_project_id="other",
        )
    await AssetReferences(assets.database).replace(
        owner=case.viewer,
        service="galgame",
        update=ReferenceUpdate(
            request_id="download-fixture",
            resource_kind="story",
            resource_id="own",
            resource_revision=6,
            expected_revision=0,
            asset_ids=[],
        ),
    )
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        for name, asset in (("restored", owned), ("wrong-scope", elsewhere)):
            db.add(
                GalgameVideoExportTask(
                    id=name,
                    project_id="own",
                    story_revision=6,
                    snapshot_id="own-snapshot",
                    request_id=name,
                    request_payload={},
                    status="completed",
                    output_asset_id=asset.id,
                    progress=100,
                )
            )
        await db.commit()
    async with (
        live.client,
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://galgame"
        ) as http,
    ):
        path = BASE + "/own/video-exports/restored/download"
        headers = await authorize(case, "galgame", "GET", path)
        full = await http.get(path, headers=headers)
        assert full.status_code == 200 and full.content == movie
        assert "no-store" in full.headers["cache-control"]
        assert "retained-export.mp4" in full.headers["content-disposition"]
        ranged = await http.get(path, headers={**headers, "Range": "bytes=2-8"})
        assert ranged.status_code == 206 and ranged.content == movie[2:9]
        assert ranged.headers["content-range"] == f"bytes 2-8/{len(movie)}"
        invalid = await http.get(path, headers={**headers, "Range": "bytes=10000-"})
        assert invalid.status_code == 416
        wrong = path.replace("/restored/", "/wrong-scope/")
        blocked = await http.get(wrong, headers=await authorize(case, "galgame", "GET", wrong))
        assert blocked.status_code == 404
