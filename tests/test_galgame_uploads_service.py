"""Verify whole upload batches and recovery after a dropped Assets acknowledgement."""

import hashlib
import io
from uuid import uuid4

import httpx
from PIL import Image
from starlette.datastructures import UploadFile
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.galgame.galgame_upload_recovery import recover_uploads
from studio.apps.asset_library.references.references import AssetReferences
from studio.apps.asset_library.storage.service_models import GalgameUploadStage
from studio.apps.galgame_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.assembly.independent.galgame_workshop.application import create_app
from studio.contracts.asset_library.references import ReferenceUpdate
from studio.contracts.galgame_workshop.galgame_upload import PREFIX
from studio.runtime.database.migrations import apply

PROJECTS = "/v1/galgame-workshop/projects"


class DropAcknowledgement(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.drop_next = False
        self.dropped = False
        self.drop_edit_commit = False
        self.drop_archive_settle = False
        self.drop_video_handoff = False

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            self.drop_next
            and request.method == "POST"
            and request.url.path.startswith(PREFIX)
            and response.status_code == 200
        ):
            self.drop_next, self.dropped = False, True
            await response.aclose()
            raise httpx.ReadError("synthetic lost Galgame upload receipt", request=request)
        if (
            self.drop_edit_commit
            and request.url.host == "assets"
            and request.method == "POST"
            and request.url.path.endswith("/commit")
            and response.status_code == 200
        ):
            self.drop_edit_commit = False
            await response.aclose()
            raise httpx.ReadError("synthetic lost Galgame file mutation receipt", request=request)
        if (
            self.drop_archive_settle
            and request.method == "POST"
            and request.url.path == "/_internal/v1/galgame-archives/settle"
            and response.status_code == 200
        ):
            self.drop_archive_settle = False
            await response.aclose()
            raise httpx.ReadError("synthetic lost Galgame archive publication", request=request)
        if (
            self.drop_video_handoff
            and request.method == "POST"
            and request.url.path.startswith("/_internal/v1/galgame-video-handoffs/")
            and response.status_code == 200
        ):
            self.drop_video_handoff = False
            await response.aclose()
            raise httpx.ReadError("synthetic lost Video handoff receipt", request=request)
        return response


def png():
    file = io.BytesIO()
    Image.new("RGB", (9, 7), "purple").save(file, "PNG")
    return file.getvalue()


async def test_upload_batch_failure_and_recovery_preserve_paths_and_exact_originals(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    case.identity.state.identity_options["service_credentials"]["galgame"] = CREDENTIALS["galgame"]
    transport = DropAcknowledgement(case.mesh)
    opts = dict(
        state_root=tmp_path,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS["galgame"],
        transport=transport,
        run_worker=False,
    )
    apply(tmp_path / "service.db", "galgame", MIGRATIONS)
    service = create_app(**opts)
    case.mesh.apps["galgame"] = service
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    image = png()

    async def send(client, method, path, **kwargs):
        return await client.request(
            method, path, headers=await authorize(case, "galgame", method, path), **kwargs
        )

    async with (
        live.client,
        service.router.lifespan_context(service),
        httpx.AsyncClient(transport=case.mesh, base_url="http://galgame") as http,
    ):
        project = await send(http, "POST", PROJECTS, json={"title": "Upload fixture"})
        assert project.status_code == 200, project.text
        base = PROJECTS + "/" + project.json()["id"] + "/assets"
        single = await send(
            http,
            "POST",
            base,
            files={"upload": ("same.png", image, "image/png")},
            data={"category": "scene"},
        )
        assert single.status_code == 200, single.text
        assert single.json()["virtualPath"] == "backgrounds/same.png"
        assert single.json()["checksumSha256"] == hashlib.sha256(image).hexdigest()
        assert single.json()["width"] == 9 and single.json()["height"] == 7

        await verify_orphan_recovery(case, project.json()["id"], image)

        async def batch(second):
            return await send(
                http,
                "POST",
                base + "/batch",
                files=[
                    ("uploads", ("same.png", image, "image/png")),
                    ("uploads", ("same.png", second, "image/png")),
                ],
                data={"category": "scene"},
            )

        failed = await batch(b"invalid PNG")
        assert failed.status_code == 422, failed.text
        assert [item["id"] for item in (await send(http, "GET", base)).json()["items"]] == [
            single.json()["id"]
        ]
        transport.drop_next = True
        lost = await batch(image)
        assert lost.status_code == 503 and lost.json()["code"] == "upload_unconfirmed", lost.text
        assert transport.dropped
        scanned = await send(http, "POST", base + "/metadata-scan")
        assert scanned.status_code == 200 and len(scanned.json()["items"]) == 3

    restarted = create_app(**opts)
    case.mesh.apps["galgame"] = restarted
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    async with (
        live.client,
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(transport=case.mesh, base_url="http://galgame") as http,
    ):
        await restarted.state.upload_intakes.recover()
        await restarted.state.upload_intakes.process_once()
        await restarted.state.upload_intakes.process_once()
        confirmed = await send(http, "GET", base)
        assert confirmed.status_code == 200, confirmed.text
        items = confirmed.json()["items"]
        assert {item["virtualPath"] for item in items} == {
            "backgrounds/same.png",
            "backgrounds/same-2.png",
            "backgrounds/same-3.png",
        }
        assert {item["checksumSha256"] for item in items} == {hashlib.sha256(image).hexdigest()}
        assert all(item["category"] == "scene" for item in items)
        for item in items:
            path = f"/v1/files/{item['id']}/download"
            blob = await http.get(
                "http://assets:8080" + path, headers=await authorize(case, "assets", "GET", path)
            )
            assert blob.status_code == 200 and blob.content == image

        async def authorized(method, path, **kwargs):
            return await send(http, method, path, **kwargs)

        await verify_metadata_edits(authorized, transport, base, items)
        await verify_project_removal(case, restarted, authorized, http, transport, base, image)


async def verify_orphan_recovery(case, project, data):
    key, identity = uuid4().hex, uuid4().hex
    storage = AssetStorage(case.assets.state.settings)
    path = storage.target_path(
        key, visual_project_id=None, galgame_project_id=project, owner_user_id=case.viewer
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    staging = path.parent / ".tmp" / f"{key}-interrupted.tmp"
    staging.parent.mkdir(exist_ok=True)
    staging.write_bytes(data[:8])
    database = case.assets.state.database
    async with database.sessions(info={"owner_user_id": case.viewer}) as session:
        session.add(
            GalgameUploadStage(
                owner_user_id=case.viewer,
                request_id=identity,
                project_id=project,
                fingerprint="a" * 64,
                storage_keys=[key],
            )
        )
        await session.commit()
    await recover_uploads(database, case.assets.state.settings)
    assert not path.exists() and not staging.exists()
    async with database.sessions(info={"owner_user_id": case.viewer}) as session:
        saved = await session.get(GalgameUploadStage, (case.viewer, identity))
        assert saved.state == "aborted" and saved.storage_keys == []


async def verify_metadata_edits(request, transport, base, items):
    by_path = {item["virtualPath"]: item for item in items}
    original = by_path["backgrounds/same.png"]
    path = f"{base}/{original['id']}"
    collision = await request(
        "PATCH",
        path,
        json={
            "expectedRevision": 0,
            "virtualPath": "backgrounds/same-2.png",
        },
    )
    assert collision.status_code == 409 and collision.json()["code"] == "virtual_path_conflict"
    patch = {
        "expectedRevision": 0,
        "displayName": "Renamed",
        "category": "cg",
        "packagingPolicy": "exclude",
    }
    transport.drop_edit_commit = True
    lost = await request("PATCH", path, json=patch)
    assert lost.status_code == 503 and lost.json()["code"] == "asset_update_unconfirmed", lost.text
    stale = await request("PATCH", path, json=patch)
    assert stale.status_code == 409, stale.text
    current = stale.json()["current"]
    assert current["display_name"] == "Renamed" and current["revision"] == 1
    assert current["virtualPath"] == "cg/Renamed.png"
    assert current["packagingPolicy"] == "exclude"
    assert current["checksumSha256"] == original["checksumSha256"]
    story_path = base.removesuffix("/assets") + "/story"
    stored = (await request("GET", story_path)).json()
    pinned = by_path["backgrounds/same-2.png"]
    stored["document"]["assets"] = [
        {
            "id": "scene",
            "type": "image",
            "role": "sceneLayer",
            "status": "ready",
            "fileId": pinned["id"],
        }
    ]
    saved = await request(
        "PUT",
        story_path,
        json={
            "expected_revision": stored["revision"],
            "document": stored["document"],
        },
    )
    assert saved.status_code == 200, saved.text
    protected = await request("DELETE", f"{base}/{pinned['id']}", params={"expected_revision": 0})
    assert protected.status_code == 409 and protected.json()["code"] == "asset_in_use", (
        protected.text
    )
    removed = await request("DELETE", path, params={"expected_revision": 1})
    assert removed.status_code == 200 and removed.json() == {"deleted": True}, removed.text
    remaining = await request("GET", base)
    assert remaining.status_code == 200
    assert original["id"] not in {item["id"] for item in remaining.json()["items"]}


async def verify_project_removal(case, app, request, http, transport, assets_path, image):
    project = assets_path.removesuffix("/assets")
    story_path = project + "/story"
    story = (await request("GET", story_path)).json()
    retained = story["document"]["assets"][0]["fileId"]
    assets = case.assets.state
    async with assets.database.sessions(info={"owner_user_id": case.viewer}) as db:
        library_file = await AssetLibrary(db, assets.settings).store_upload(
            UploadFile(io.BytesIO(image), filename="library.png"), owner_user_id=case.viewer
        )
    story["document"]["assets"].append(
        {
            "id": "library",
            "fileId": library_file.id,
            "type": "image",
            "role": "sceneLayer",
            "status": "ready",
        }
    )
    saved = await request(
        "PUT",
        story_path,
        json={
            "expected_revision": story["revision"],
            "document": story["document"],
        },
    )
    assert saved.status_code == 200, saved.text
    stale = await request("DELETE", project, params={"expected_revision": 99})
    assert stale.status_code == 409 and stale.json()["current"]["revision"] == 0
    reference = AssetReferences(assets.database)
    await reference.replace(
        owner=case.viewer,
        service="presentation",
        update=ReferenceUpdate(
            request_id="foreign-pin",
            resource_kind="project",
            resource_id="test-presentation",
            resource_revision=0,
            expected_revision=0,
            asset_ids=[retained],
        ),
    )
    protected = await request("DELETE", project, params={"expected_revision": 0})
    assert protected.status_code == 409 and protected.json()["code"] == "asset_in_use", (
        protected.text
    )
    await reference.replace(
        owner=case.viewer,
        service="presentation",
        update=ReferenceUpdate(
            request_id="release-foreign-pin",
            resource_kind="project",
            resource_id="test-presentation",
            resource_revision=1,
            expected_revision=1,
            asset_ids=[],
        ),
    )
    transport.drop_edit_commit = True
    lost = await request("DELETE", project, params={"expected_revision": 0})
    assert lost.status_code == 503 and lost.json()["code"] == "project_deletion_unconfirmed", (
        lost.text
    )
    await app.state.reference_delivery.process_once()
    assert (await request("GET", project)).status_code == 404
    for file_id, status in ((retained, 404), (library_file.id, 200)):
        path = f"/v1/files/{file_id}/download"
        reply = await http.get(
            "http://assets:8080" + path, headers=await authorize(case, "assets", "GET", path)
        )
        assert reply.status_code == status, reply.text
        if status == 200:
            assert reply.content == image
