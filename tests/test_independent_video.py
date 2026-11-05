"""The Video Editor owns project and timeline records in a dedicated database."""

from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import select
from starlette.datastructures import Headers, UploadFile
from tests.test_community_asset_protocol import ASSETS_SECRET, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_assets.scoped_project_files import check_writable
from fpl_deployment.images import source_closure
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.claims import HEADER, Actor, issue_context
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog
from fpl_video.application import PROJECTS, create_app
from fpl_video.migrations.registry import MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]


def test_video_image_excludes_compatibility_layout_and_foreign_orm():
    closure = source_closure(ROOT, "video")
    assert "fpl_video.application" in closure
    assert "app.apps.video_editor.timeline_read" in closure
    assert "app.apps.video_editor.legacy_project_layouts" not in closure
    assert "app.capabilities.asset_store.models" not in closure
    assert "app.runtime.db" not in closure


async def test_video_owned_projects_and_timeline_survive_restart(scenario, tmp_path):  # noqa: F811
    case = scenario
    key = case.key
    credential = "isolated-video-layout-test-credential"
    case.identity.state.identity_options["service_credentials"]["video"] = credential
    assets_identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.identity = assets_identity
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    apply(tmp_path / "service.db", "video", MIGRATIONS)

    def app():
        return create_app(
            state_root=tmp_path,
            catalog=catalog,
            public_key=key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
            credential=credential,
            transport=case.mesh,
            run_worker=False,
        )

    async def call(api, method, path, *, owner="alpha", **kwargs):
        if owner == "alpha":
            headers = await authorize(case, "video", method, path)
            return await api.request(method, path, headers=headers, **kwargs)
        token = issue_context(
            Actor(
                owner,
                "user",
                "session",
                ("studio:read", "studio:private_read", "studio:write"),
                session_id=owner,
            ),
            service="video",
            method=method,
            path=path,
            private_key=key,
            key_id="isolated-video",
        )
        return await api.request(method, path, headers={HEADER: token}, **kwargs)

    first = app()
    async with (
        first.router.lifespan_context(first),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=first), base_url="http://video") as api,
    ):
        assert (await api.get("/ready")).status_code == 503
        assert (await api.get(PROJECTS)).status_code == 401
        created = await call(api, "POST", PROJECTS, json={"title": "Owned Video"})
        assert created.status_code == 200, created.text
        project = PROJECTS + "/" + created.json()["id"]
        original = (await call(api, "GET", project + "/timeline")).json()
        assert original["revision"] == 0 and len(original["document"]["tracks"]) == 3
        assert (await call(api, "GET", project, owner="beta")).status_code == 404
        assert (await call(api, "GET", project + "/timeline", owner="beta")).status_code == 404
        assert (await call(api, "GET", PROJECTS, owner="beta")).json()["items"] == []
        body = {"title": "New Name", "expectedRevision": 0}
        assert (await call(api, "PATCH", project, owner="beta", json=body)).status_code == 404
        patched = await call(api, "PATCH", project, json=body)
        assert patched.status_code == 200, patched.text
        assert (await call(api, "PATCH", project, json=body)).status_code == 409

    second = app()
    async with (
        second.router.lifespan_context(second),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second), base_url="http://video"
        ) as api,
    ):
        assert (await call(api, "GET", PROJECTS)).json()["items"] == [patched.json()]
        assert (await call(api, "GET", project + "/timeline")).json() == original
        assert (
            await call(api, "DELETE", project, owner="beta", params={"expected_revision": 1})
        ).status_code == 404
        stale = await call(api, "DELETE", project, params={"expected_revision": 0})
        assert stale.status_code == 409
        removed = await call(api, "DELETE", project, params={"expected_revision": 1})
        assert removed.status_code == 200, removed.text
        assert (await call(api, "GET", project + "/timeline")).status_code == 404
    await assets_identity.close()


async def test_timeline_edits_check_actual_signed_asset_scope(scenario, tmp_path, monkeypatch):  # noqa: F811
    case = scenario
    credential = "isolated-video-timeline-test-credential"
    case.identity.state.identity_options["service_credentials"]["video"] = credential
    state = tmp_path / "video"
    apply(state / "service.db", "video", MIGRATIONS)
    assets_identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.identity = assets_identity
    app = create_app(
        state_root=state,
        catalog=RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
        public_key=case.key.public_key(),
        schema_path=ROOT / "web/src/generated/openapi.json",
        credential=credential,
        transport=case.mesh,
        run_worker=False,
    )

    async def send(api, method, path, **kwargs):
        return await api.request(
            method, path, headers=await authorize(case, "video", method, path), **kwargs
        )

    async def fixture_file(owner, project):
        source = BytesIO()
        Image.new("RGB", (3, 3), "navy").save(source, format="PNG")
        source.seek(0)
        settings = case.assets.state.settings
        async with case.assets.state.database.sessions(info={"owner_user_id": owner}) as session:
            row = await AssetLibrary(session, settings).store_upload(
                UploadFile(
                    source, filename="clip.png", headers=Headers({"Content-Type": "image/png"})
                ),
                owner_user_id=owner,
                video_editor_project_id=project,
            )
            return row.id

    async with (
        assets_identity.client,
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://video") as api,
    ):
        project_response = await send(api, "POST", PROJECTS, json={"title": "Timeline"})
        assert project_response.status_code == 200, project_response.text
        project = project_response.json()["id"]
        other_response = await send(api, "POST", PROJECTS, json={"title": "Other Project"})
        other = other_response.json()["id"]
        target = PROJECTS + "/" + project + "/timeline/operations"
        attached = await fixture_file(case.viewer, project)
        wrong_scope = await fixture_file(case.viewer, other)
        foreign = await fixture_file(case.owner, project)
        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
            # Storage-only fixture setup in the per-test service database.
            session.add(
                VideoEditorAssetMetadata(
                    asset_id=attached, project_id=project, processing_status="ready"
                )
            )
            await session.commit()

        def payload(identity, *, revision=0, kind="image"):
            return {
                "expectedRevision": revision,
                "requestId": "video-test-timeline",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "image-1",
                            "trackId": "visual-1",
                            "kind": kind,
                            "name": "Image",
                            "durationUs": 1_000_000,
                            "timelineStartUs": 0,
                            "assetId": identity,
                        },
                    }
                ],
            }

        for identity in (wrong_scope, foreign):
            rejected = await send(api, "POST", target, json=payload(identity))
            assert rejected.status_code == 422 and rejected.json()["code"] == "invalid_asset"
        invalid_kind = await send(api, "POST", target, json=payload(attached, kind="video"))
        assert (
            invalid_kind.status_code == 422 and invalid_kind.json()["code"] == "invalid_asset_kind"
        )
        edited = await send(api, "POST", target, json=payload(attached))
        assert edited.status_code == 200, edited.text
        assert edited.json()["revision"] == 1
        assert edited.json()["document"]["tracks"][0]["clips"][0]["assetId"] == attached
        replayed = await send(api, "POST", target, json=payload(attached))
        assert replayed.json() == edited.json()
        stale = {**payload(attached), "requestId": "different-edit-id"}
        assert (await send(api, "POST", target, json=stale)).status_code == 409

        delivery = app.state.reference_delivery
        commit = delivery.client.commit
        requested = False

        async def lost_reply(**arguments):
            nonlocal requested
            if arguments["deleted"]:
                requested = True
                raise CapabilityUnavailable("isolated transport interrupted")
            return await commit(**arguments)

        project_path = PROJECTS + "/" + project
        with monkeypatch.context() as fault:
            fault.setattr(delivery.client, "commit", lost_reply)
            deleted = await send(api, "DELETE", project_path, params={"expected_revision": 0})
        assert deleted.status_code == 200 and requested, deleted.text
        assert (await send(api, "GET", project_path)).status_code == 404
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            assert await db.get(VisualAsset, attached) is not None
            with pytest.raises(AssetError) as pending:
                await check_writable(db, "video", project)
            assert pending.value.code == "video_project_deletion_pending"
        await delivery.process_once()
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            assert await db.get(VisualAsset, attached) is None
            assert await db.get(VisualAsset, wrong_scope) is not None
        async with case.assets.state.database.sessions(info={"owner_user_id": case.owner}) as db:
            assert await db.get(VisualAsset, foreign) is not None


class DropAssetWriteReply(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.receipt_path = None

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            self.receipt_path is None
            and request.url.host == "assets"
            and request.method == "POST"
            and "/writes/" in request.url.path
            and response.status_code == 200
        ):
            self.receipt_path = request.url.path
            await response.aclose()
            raise httpx.ReadError("asset acknowledgement dropped", request=request)
        return response


async def test_upload_and_copy_recover_durable_receipt_after_restart(scenario, tmp_path):  # noqa: F811
    case = scenario
    credential = "isolated-video-intake-test-credential"
    case.identity.state.identity_options["service_credentials"]["video"] = credential
    state = tmp_path / "video"
    apply(state / "service.db", "video", MIGRATIONS)
    assets_identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.identity = assets_identity
    faults = DropAssetWriteReply(case.mesh)

    def new_app():
        return create_app(
            state_root=state,
            catalog=RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
            public_key=case.key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
            credential=credential,
            transport=faults,
            run_worker=False,
        )

    async def send(api, method, path, **kwargs):
        return await api.request(
            method, path, headers=await authorize(case, "video", method, path), **kwargs
        )

    source = BytesIO()
    Image.new("RGB", (3, 3), "orange").save(source, format="PNG")
    raw = source.getvalue()
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        library = await AssetLibrary(db, case.assets.state.settings).store_upload(
            UploadFile(
                BytesIO(raw), filename="library.png", headers=Headers({"Content-Type": "image/png"})
            ),
            owner_user_id=case.viewer,
        )
        library_id = library.id

    async with assets_identity.client:
        first = new_app()
        async with (
            first.router.lifespan_context(first),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=first), base_url="http://video"
            ) as api,
        ):
            created = await send(api, "POST", PROJECTS, json={"title": "Intake"})
            assert created.status_code == 200, created.text
            files = PROJECTS + "/" + created.json()["id"] + "/assets"
            sources = await send(api, "GET", "/v1/video-editor/import-sources")
            assert library_id in {item["id"] for item in sources.json()["items"]}
            lost = await send(
                api, "POST", files, files={"upload": ("uploaded.png", raw, "image/png")}
            )
            assert lost.status_code == 503 and faults.receipt_path, lost.text
            assert (await send(api, "GET", files)).json()["items"] == []

        second = new_app()
        async with (
            second.router.lifespan_context(second),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=second), base_url="http://video"
            ) as api,
        ):
            intakes = second.state.asset_intakes
            await intakes.process_once()
            await intakes.process_once()
            registered = (await send(api, "GET", files)).json()["items"]
            assert len(registered) == 1 and registered[0]["byteSize"] == len(raw)
            assert registered[0]["processingStatus"] == "queued"
            assert registered[0]["originalFilename"] == "uploaded.png"
            copied = await send(api, "POST", files + "/import", json={"assetIds": [library_id]})
            assert copied.status_code == 200, copied.text
            imported = copied.json()["items"][0]["id"]
            assert imported != library_id
            assert {item["id"] for item in (await send(api, "GET", files)).json()["items"]} == {
                imported,
                registered[0]["id"],
            }
            same_project_copy = await send(
                api, "POST", files + "/import", json={"assetIds": [imported]}
            )
            assert same_project_copy.status_code == 422
            async with case.assets.state.database.sessions(
                info={"owner_user_id": case.viewer}
            ) as db:
                storage = AssetStorage(case.assets.state.settings)
                for identity in (imported, registered[0]["id"], library_id):
                    row = await db.get(VisualAsset, identity)
                    assert storage.path_for(row).read_bytes() == raw
            async with second.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
                tasks = (await db.scalars(select(VideoEditorTask))).all()
                assert sorted(task.request_payload["assetId"] for task in tasks) == sorted(
                    [imported, registered[0]["id"]]
                )
