"""Exercise the published multipart route through the real isolated service mesh."""

import io
import json
import zipfile

import httpx
import pytest
from sqlalchemy import select
from tests.test_community_asset_protocol import (
    ASSETS_SECRET,
    CATALOG,
    PEER_SECRET,
    THOUGHT_SECRET,
    scenario,  # noqa: F401
)

from studio.apps.asset_library.clients.retention import RetentionClient
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import AssetReferencePin
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.thought_workshop.schemas.document import empty_document
from studio.apps.thought_workshop.storage.models import ThoughtNote
from studio.assembly.independent.thought_workshop.application import create_app
from studio.contracts.identity.claims import HEADER
from studio.contracts.thought_workshop.thought_archives import IMPORT_PATH, PREFIX, SETTLE_PATH

ORIGIN = "http://127.0.0.1:19000"
IMAGE = b"\x89PNG\r\n\x1a\narchived image"
TIME = "2026-11-03T10:00:00"


def archive():
    manifest = {
        "format": "thought-workshop-backup",
        "version": 9,
        "knowledge_bases": [{"id": "source", "title": "Source", "home_note_id": "home"}],
        "notes": [
            {
                "id": "home",
                "title": "Home",
                "is_home": True,
                "knowledge_base_id": "source",
                "document": empty_document(),
            },
            {
                "id": "article",
                "title": "Deleted article",
                "deleted_at": TIME,
                "knowledge_base_id": "source",
                "document": empty_document(),
            },
        ],
        "assets": [
            {
                "id": "old-image",
                "path": "assets/old-image",
                "filename": "historic.png",
                "content_type": "image/png",
            }
        ],
        "history": [
            {
                "id": "old-history",
                "note_id": "article",
                "title": "Prior article",
                "revision": 3,
                "document": {
                    "type": "doc",
                    "content": [{"type": "image", "attrs": {"assetId": "old-image"}}],
                },
                "tags": [],
                "author_name": "Original writer",
                "source": "edit",
                "created_at": TIME,
            }
        ],
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as target:
        target.writestr("manifest.json", json.dumps(manifest))
        target.writestr("assets/old-image", IMAGE)
    return stream.getvalue()


class LoseResponse(httpx.AsyncBaseTransport):
    def __init__(self, mesh, step):
        self.mesh, self.step = mesh, step
        self.lost = False

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        path = request.url.path
        if (
            request.url.host == "assets"
            and path.startswith(PREFIX)
            and response.status_code == 200
            and not self.lost
            and (path == SETTLE_PATH if self.step == "settle" else f"/{self.step}/" in path)
        ):
            self.lost = True
            await response.aclose()
            raise httpx.ReadError("response lost after target commit", request=request)
        return response


def thought_app(case, transport):
    return create_app(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=transport
        ),
        retention_client=RetentionClient(
            service="thought", credential=THOUGHT_SECRET, transport=transport
        ),
        assets_peer_credential=PEER_SECRET,
        upload_receipt_credential="u" * 48,
        transport=transport,
        run_worker=False,
    )


async def headers(case, method, path):
    response = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": "thought",
            "X-Fpl-Request-Method": method,
            "X-Fpl-Request-Uri": path,
            "Origin": ORIGIN,
            "X-CSRF-Token": case.csrf,
        },
    )
    assert response.status_code == 204, response.text
    return {HEADER: response.headers[HEADER], "Idempotency-Key": "archive-retry"}


@pytest.mark.parametrize("step", ["files", "seal", "settle"])
async def test_archive_http_replays_a_lost_assets_ack_without_duplicate_rows(scenario, step):  # noqa: F811
    case = scenario
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    transport = LoseResponse(case.mesh, step)
    app = thought_app(case, transport)
    data = archive()

    async def post(client, payload=data):
        return await client.post(
            IMPORT_PATH,
            headers=await headers(case, "POST", IMPORT_PATH),
            files={"upload": ("account.zip", payload, "application/zip")},
        )

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://thought") as c,
    ):
        first = await post(c)
        assert first.status_code == 503 and transport.lost, first.text
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            rows = (await session.scalars(select(VisualAsset))).all()
            assert len(rows) == (1 if step == "settle" else 0)

    scratch = case.db.root / "archive-staging"
    (batch_path,) = scratch.iterdir()
    retained = batch_path / "retained-on-crash"
    retained.write_bytes(b"pending batch data")
    restarted = thought_app(case, case.mesh)
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://thought"
        ) as c,
    ):
        await restarted.state.thought_archive_delivery.recover()
        assert retained.is_file()
        resumed = await post(c)
        assert resumed.status_code == 200, resumed.text
        assert not batch_path.exists()
        replay = await post(c)
        assert replay.json() == resumed.json()
        assert (await post(c, data + b"changed")).status_code == 409
        out = resumed.json()
        assert len(out["knowledge_base_ids"]) == len(out["note_ids"]) == 1
        async with restarted.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            notes = (await session.scalars(select(ThoughtNote))).all()
            assert len(notes) == 2
            trashed = next(note for note in notes if note.id == out["note_ids"][0])
            assert trashed.deleted_at and trashed.revision == 4
        backup_path = "/v1/thought-workshop/backup"
        response = await c.get(
            backup_path,
            params={"knowledge_base_id": out["knowledge_base_ids"][0]},
            headers=await headers(case, "GET", backup_path),
        )
        assert response.status_code == 200, response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as backup:
            recovered = json.loads(backup.read("manifest.json"))
            assert len(recovered["assets"]) == 1
            assert backup.read(recovered["assets"][0]["path"]) == IMAGE
            assert recovered["assets"][0]["id"] != "old-image"
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            asset = (await session.scalars(select(VisualAsset))).one()
            pin = (await session.scalars(select(AssetReferencePin))).one()
            assert pin.asset_id == asset.id


async def test_assets_rejects_an_unsigned_archive_outcome(scenario):  # noqa: F811
    case = scenario
    async with httpx.AsyncClient(transport=case.mesh) as client:
        response = await client.post(
            "http://assets" + SETTLE_PATH,
            headers={"X-Fpl-Archive-Nonce": "0" * 32},
            json={
                "owner": case.owner,
                "batch_id": "0" * 32,
                "source_sha256": "0" * 64,
                "decision": "abort",
            },
        )
        assert response.status_code == 401


async def test_target_revision_conflict_aborts_staging_and_keeps_existing_home(scenario):  # noqa: F811
    case = scenario
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    app = thought_app(case, case.mesh)
    data = archive()

    async def post(client, key, params=None):
        return await client.post(
            IMPORT_PATH,
            params=params,
            headers={**await headers(case, "POST", IMPORT_PATH), "Idempotency-Key": key},
            files={"upload": ("account.zip", data, "application/zip")},
        )

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://thought") as c,
    ):
        original = await post(c, "create")
        assert original.status_code == 200, original.text
        project = original.json()["knowledge_base_ids"][0]
        conflict = await post(c, "stale", {"knowledge_base_id": project, "expected_revision": 5})
        assert conflict.status_code == 409, conflict.text
        await app.state.thought_archive_delivery.process_once()
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            assert len((await session.scalars(select(VisualAsset))).all()) == 1
        appended = await post(c, "append", {"knowledge_base_id": project, "expected_revision": 0})
        assert appended.status_code == 200, appended.text
        assert appended.json()["knowledge_base_ids"] == [project]
        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
            notes = (await session.scalars(select(ThoughtNote))).all()
            assert len(notes) == 3
            assert sum(note.is_home for note in notes) == 1
