"""Published project roots work without any access to the Assets database."""

import io
import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select
from starlette.datastructures import UploadFile
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS, ORIGIN, PROJECTS

from app.apps.galgame_workshop.models import GalgameStorySnapshot
from app.capabilities.asset_store.library import AssetLibrary
from fpl_assets.models import AssetReferencePin, AssetReferenceSet
from fpl_galgame.models import GalgameStoryReferenceMutation
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]


async def authorize(case, kind, method, path):
    response = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": kind,
            "X-Fpl-Request-Method": method,
            "X-Fpl-Request-Uri": path,
            "Origin": ORIGIN,
            "X-CSRF-Token": case.csrf,
        },
    )
    assert response.status_code == 204, response.text
    return {HEADER: response.headers[HEADER]}


class LostStoryCommit(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.lost = False

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            not self.lost
            and request.url.host == "assets"
            and request.url.path.endswith("/commit")
            and json.loads(request.content).get("resource_revision") == 1
            and response.status_code == 200
        ):
            self.lost = True
            await response.aclose()
            raise httpx.ReadError("isolated missing Story acknowledgement", request=request)
        return response


@pytest.mark.parametrize("kind", ["visual", "galgame"])
async def test_projects_create_owned_defaults_and_keep_the_published_contract(
    scenario,  # noqa: F811
    tmp_path,
    kind,
):
    case = scenario
    factory, migrations, model, _ = PROJECTS[kind]
    apply(tmp_path / "service.db", kind, migrations)
    transport = LostStoryCommit(case.mesh)
    options = dict(
        state_root=tmp_path,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS[kind],
        transport=transport,
        run_worker=False,
    )
    app = factory(**options)
    case.mesh.apps[kind] = app
    case.identity.state.identity_options["service_credentials"].update(CREDENTIALS)
    asset_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = asset_live
    public = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/v1/"):
            for method, operation in operations.items():
                assert operation == public[path][method]
    prefix = f"/v1/{kind}-workshop/projects"
    suffix = "canvas" if kind == "visual" else "story"
    async with (
        asset_live.client,
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=f"http://{kind}"
        ) as http,
    ):

        async def request(method, path, **kwargs):
            return await http.request(
                method, path, headers=await authorize(case, kind, method, path), **kwargs
            )

        assert (await http.get(prefix)).status_code == 401
        assert (await request("GET", prefix)).json() == {"items": []}
        fields = {"title": "Owned project", **({"kind": "canvas"} if kind == "visual" else {})}
        created = await request("POST", prefix, json=fields)
        assert created.status_code == 200, created.text
        record = created.json()
        assert record["title"] == fields["title"]
        assert record["revision"] == 0 and not record["is_official"]
        path = prefix + "/" + record["id"]
        document = await request("GET", path + "/" + suffix)
        assert document.status_code == 200, document.text
        if kind == "visual":
            assert document.json()["nodes"] == []
            assert document.json()["categories"]
            changed = await request(
                "PATCH", path, json={"title": "Changed", "expected_revision": 0}
            )
            assert changed.status_code == 200, changed.text
            conflict = await request("PATCH", path, json={"title": "Stale", "expected_revision": 0})
            assert conflict.status_code == 409, conflict.text
            assert conflict.json()["current"]["title"] == "Changed"
            record = changed.json()
        else:
            assert document.json()["document"]["entryChapterId"] == "chapter-1"
            asset_id = await verify_galgame_story(
                case, app, request, path, document.json()["document"]
            )
        assert (await request("GET", path)).json() == record
        async with app.state.database.sessions(info={"owner_user_id": case.owner}) as session:
            session.add(
                model(
                    id="other",
                    owner_user_id=case.owner,
                    title="Other project",
                    **({"kind": "canvas"} if kind == "visual" else {}),
                )
            )
            await session.commit()
        assert (await request("GET", prefix + "/other")).status_code == 404
        assert (await request("GET", prefix + "/other/" + suffix)).status_code == 404
        assert (await request("GET", prefix)).json() == {"items": [record]}

    if kind == "galgame":
        assert transport.lost
        restarted = factory(**options)
        case.mesh.apps[kind] = restarted
        recovery_auth = LiveAuthorization(
            service="assets", credential=ASSETS_SECRET, transport=case.mesh
        )
        case.assets.state.identity = recovery_auth
        async with recovery_auth.client, restarted.router.lifespan_context(restarted):
            delivery = restarted.state.reference_delivery
            await delivery.recover()
            await delivery.process_once()
            async with restarted.state.database.sessions(
                info={"owner_user_id": case.viewer}
            ) as session:
                outcomes = (await session.scalars(select(GalgameStoryReferenceMutation))).all()
                assert any(
                    row.state == "delivered"
                    and row.delivered_result["state"] == "committed"
                    and row.resource_revision == 1
                    for row in outcomes
                )
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            pins = await session.scalars(
                select(AssetReferencePin.asset_id)
                .join(AssetReferenceSet, AssetReferenceSet.id == AssetReferencePin.reference_set_id)
                .where(
                    AssetReferenceSet.service_id == "galgame",
                    AssetReferenceSet.resource_kind == "story",
                )
            )
            assert list(pins) == [asset_id]


async def verify_galgame_story(case, app, request, path, document):
    story_path = path + "/story"
    document["characters"] = [{"id": "writer", "name": "Writer"}]
    document["chapters"][0]["fragments"][0]["blocks"] = [
        {"id": "line", "type": "dialogue", "characterId": "writer", "text": "Initial"},
        {"id": "stage", "type": "showCharacter", "characterId": "writer"},
    ]
    image = {
        "id": "fixture-image",
        "type": "image",
        "role": "sceneLayer",
        "status": "ready",
        "fileId": case.asset,
    }

    async def save():
        return await request(
            "PUT",
            story_path,
            json={"expected_revision": 0, "document": {**document, "assets": [image]}},
        )

    context = await authorize(case, "galgame", "PUT", story_path)
    with pytest.raises(CapabilityDenied) as rejected:
        await app.state.retention_client.authorize(
            assertion=context[HEADER],
            source_method="PUT",
            source_path=story_path,
            change=PrepareReferenceChange(
                request_id="mismatched-request",
                resource_kind="story",
                resource_id="other-project",
                expected_resource_revision=0,
                asset_ids=[],
                metadata_asset_ids=[],
            ),
        )
    assert rejected.value.status == 403

    foreign = await save()
    assert foreign.status_code == 422 and foreign.json()["code"] == "invalid_story_document"
    assert (await request("GET", story_path)).json()["revision"] == 0
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        asset = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\nisolated story image"), filename="story.png"),
            owner_user_id=case.viewer,
        )
        image["fileId"] = asset.id
    saved = await save()
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1 and saved.json()["document"]["assets"] == [image]
    stale = await save()
    assert stale.status_code == 409 and stale.json()["current"]["revision"] == 1

    with pytest.raises(CapabilityUnavailable):
        await app.state.reference_delivery.process_once()
    dialogue = {"fragmentId": "main", "blockId": "line", "text": "Changed"}
    stage = {"fragmentId": "main", "blockId": "stage", "characterId": "writer"}
    for revision, endpoint, payload in (
        (1, "dialogue", dialogue),
        (2, "stage-expression", stage),
    ):
        edited = await request(
            "PATCH", f"{story_path}/{endpoint}", json={"expected_revision": revision, **payload}
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["revision"] == revision + 1 and "document" not in edited.json()
    edit = {"type": "dialogue", **dialogue, "text": "Batch"}
    batch = await request(
        "PATCH", story_path + "/edits", json={"expected_revision": 3, "edits": [edit]}
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["revision"] == 4 and batch.json()["document"]["assets"] == [image]
    assert batch.json()["document"]["chapters"][0]["fragments"][0]["blocks"][0]["text"] == "Batch"
    operations = {
        "request_id": "story-operation-fixture",
        "expected_revision": 4,
        "operations": [
            {
                "entity": "block",
                "action": "update",
                "id": "line",
                "parent_id": "main",
                "value": {"text": "Operation", "content": None},
            }
        ],
    }
    operation_path = story_path + "/operations"
    operated = await request("POST", operation_path, json=operations)
    assert operated.status_code == 200, operated.text
    original = operated.json()
    assert original["revision"] == 5 and original["document"]["assets"] == [image]
    replayed = await request("POST", operation_path, json=operations)
    assert replayed.status_code == 200 and replayed.json() == original
    mismatched = await request(
        "POST", operation_path, json={**operations, "settings": {"synopsis": "New body"}}
    )
    assert mismatched.status_code == 409 and mismatched.json()["code"] == "idempotency_conflict"
    project_id = path.rsplit("/", 1)[1]
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        session.add(
            GalgameStorySnapshot(
                id="saved-snapshot",
                project_id=project_id,
                story_revision=1,
                reason="portrait-size-upgrade",
                document=saved.json()["document"],
            )
        )
        await session.commit()
    snapshots_path = story_path + "/snapshots"
    listing = await request("GET", snapshots_path)
    assert listing.status_code == 200, listing.text
    assert [item["id"] for item in listing.json()] == ["saved-snapshot"]
    assert listing.json()[0]["storyRevision"] == 1
    missing = await request(
        "POST",
        snapshots_path + "/unknown/restore",
        json={"expectedStoryRevision": 5},
    )
    assert missing.status_code == 404 and missing.json()["code"] == "not_found"
    restored = await request(
        "POST",
        snapshots_path + "/saved-snapshot/restore",
        json={"expectedStoryRevision": 5},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["revision"] == 6
    assert restored.json()["document"] == saved.json()["document"]
    assert (
        await request(
            "POST", snapshots_path + "/saved-snapshot/restore", json={"expectedStoryRevision": 5}
        )
    ).status_code == 409
    return image["fileId"]
