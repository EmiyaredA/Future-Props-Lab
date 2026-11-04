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

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameStorySnapshot,
)
from app.apps.visual_workshop.acceptance.models import (
    AcceptanceRun,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
)
from app.apps.visual_workshop.models import (
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.capabilities.asset_store.library import AssetLibrary
from fpl_assets.models import AssetReferencePin, AssetReferenceSet
from fpl_galgame.models import GalgameStoryReferenceMutation
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityClient, CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_assets import PURPOSE as GALGAME_FILES_READ
from fpl_runtime.galgame_assets import GalgameAssetQuery
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
        transport=transport if kind == "galgame" else case.mesh,
        run_worker=False,
    )
    app = factory(**options)
    case.mesh.apps[kind] = app
    case.identity.state.identity_options["service_credentials"].update(CREDENTIALS)
    asset_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = asset_live
    asset_capabilities = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )
    case.assets.state.capabilities = asset_capabilities
    public = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/v1/"):
            for method, operation in operations.items():
                assert operation == public[path][method]
    prefix = f"/v1/{kind}-workshop/projects"
    suffix = "canvas" if kind == "visual" else "story"
    async with (
        asset_live.client,
        asset_capabilities.client,
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
            await verify_visual_canvas(case, app, request, path)
            await verify_visual_records(case, app, request, record["id"])
            await verify_visual_reviews(case, app, request, record["id"])
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
            await verify_galgame_files(case, app, request, path, asset_id)
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
            await verify_galgame_formats(case, app, request, prefix)

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


async def verify_visual_canvas(case, app, request, path):
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        asset = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\nvisual PNG"), filename="canvas.png"),
            owner_user_id=case.viewer,
        )
    node = {
        "id": "node",
        "kind": "image",
        "title": "Picture",
        "position": {"x": 0, "y": 0},
        "asset_id": case.asset,
    }
    canvas = path + "/canvas"
    outside = await request("PUT", canvas, json={"expected_revision": 0, "nodes": [node]})
    assert outside.status_code == 422 and outside.json()["code"] == "asset_not_found"
    node["asset_id"] = asset.id
    unlinked = await request("PUT", canvas, json={"expected_revision": 0, "nodes": [node]})
    assert unlinked.status_code == 422 and unlinked.json()["code"] == "scope_mismatch"
    links = path + "/asset-references"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=case.assets), base_url="http://assets"
    ) as assets:
        placed = await assets.post(
            links,
            headers=await authorize(case, "assets", "POST", links),
            json={"asset_id": asset.id},
        )
        assert placed.status_code == 200, placed.text
        first = await request("PUT", canvas, json={"expected_revision": 0, "nodes": [node]})
        assert first.status_code == 200, first.text
        output = first.json()["nodes"][0]["final_output_id"]
        assert first.json()["revision"] == 1 and output
        link = placed.json()
        placed_path = f"{links}/{link['reference_id']}"
        deleted = await assets.delete(
            placed_path,
            headers=await authorize(case, "assets", "DELETE", placed_path),
            params={"expected_revision": link["revision"]},
        )
        assert deleted.status_code == 200, deleted.text
    second = await request("PUT", canvas, json={"expected_revision": 1, "nodes": [node]})
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2
    assert second.json()["nodes"][0]["final_output_id"] == output
    operation_path = canvas + "/operations"
    operation = {
        "request_id": "canvas-edit-fixture",
        "expected_revision": 2,
        "operations": [
            {"entity": "node", "id": "node", "action": "update", "value": {"title": "Edited"}}
        ],
    }
    operated = await request("POST", operation_path, json=operation)
    assert operated.status_code == 200, operated.text
    edited = operated.json()
    assert edited["revision"] == 3 and edited["nodes"][0]["final_output_id"] == output
    assert edited["nodes"][0]["title"] == "Edited"
    outputs = path + "/nodes/node/outputs"
    listing = await request("GET", outputs)
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] == 1 and listing.json()["items"][0]["id"] == output
    assert (await request("GET", outputs, params={"page": 2})).json() == {"items": [], "total": 1}
    assert (await request("GET", outputs + "/" + output)).json() == listing.json()["items"][0]
    assert (await request("GET", outputs.replace("/node/", "/different/"))).status_code == 404
    replayed = await request("POST", operation_path, json=operation)
    assert replayed.status_code == 200 and replayed.json() == edited
    other_body = {**operation, "expected_revision": 3}
    mismatched = await request("POST", operation_path, json=other_body)
    assert mismatched.status_code == 409 and mismatched.json()["code"] == "idempotency_conflict"
    await app.state.reference_delivery.process_once()
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        pins = await session.scalars(
            select(AssetReferencePin.asset_id)
            .join(AssetReferenceSet, AssetReferenceSet.id == AssetReferencePin.reference_set_id)
            .where(
                AssetReferenceSet.service_id == "visual",
                AssetReferenceSet.resource_kind == "canvas",
                AssetReferenceSet.resource_revision == 3,
            )
        )
        assert list(pins) == [asset.id]


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


async def verify_visual_records(case, app, request, project_id):
    root = "/v1/visual-workshop"
    project = f"{root}/projects/{project_id}"
    project_standard = f"{project}/acceptance/standard"
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        session.add(
            AcceptanceTemplate(id="historical", title="Old preset", document={}, revision=3)
        )
        session.add(
            VisualGenerationBatch(
                id="batch",
                project_id=project_id,
                grid_size=4,
                status="failed",
                child_task_ids=["recoverable"],
            )
        )
        for id_, fields in (
            ("queued", {}),
            (
                "recoverable",
                {
                    "status": "failed",
                    "provider_task_id": "accepted-once",
                    "error_message": "任务处理失败（ReadTimeout）",
                    "request_payload": {"generation_batch_id": "batch"},
                },
            ),
        ):
            session.add(
                VisualGenerationTask(
                    id=id_,
                    project_id=project_id,
                    provider_kind="volcengine_image",
                    provider_name="Example",
                    model_slug="test-image",
                    generation_kind="image",
                    **fields,
                )
            )
        await session.commit()
    async with app.state.database.sessions(info={"owner_user_id": case.owner}) as session:
        other_id = "foreign-visual-record-project"
        session.add(VisualWorkshopProject(id=other_id, title="Private", kind="canvas"))
        await session.flush()
        session.add_all(
            [
                AcceptanceTemplate(id="foreign-template", title="Private preset", document={}),
                VisualGenerationTask(
                    id="foreign-task",
                    project_id=other_id,
                    provider_kind="volcengine_image",
                    provider_name="Example",
                    model_slug="test-image",
                    generation_kind="image",
                ),
            ]
        )
        await session.commit()
    templates = await request("GET", f"{root}/acceptance-templates")
    assert templates.status_code == 200, templates.text
    assert any(item["builtin"] for item in templates.json()["items"])
    historical = {
        item["id"]: item["revision"] for item in templates.json()["items"] if not item["builtin"]
    }
    assert historical == {"historical": 3}
    standard = await request("GET", project_standard)
    assert standard.status_code == 200 and standard.json()["project_id"] == project_id
    assert (await request("GET", f"{root}/projects/missing/acceptance/standard")).status_code == 404
    retired = await request("PUT", project_standard, json={"expected_revision": 0, "document": {}})
    assert retired.status_code == 410 and retired.json()["code"] == "acceptance_api_replaced"
    tasks = f"{root}/generation-tasks"
    listed = await request("GET", tasks)
    assert listed.status_code == 200, listed.text
    assert {item["id"] for item in listed.json()["items"]} == {"queued", "recoverable"}
    assert (await request("GET", f"{tasks}/foreign-task")).status_code == 404
    assert (
        await request("POST", f"{tasks}/foreign-task/cancel", json={"expected_revision": 0})
    ).status_code == 404
    stale = await request("POST", f"{tasks}/queued/cancel", json={"expected_revision": 1})
    assert stale.status_code == 409 and stale.json()["current"]["status"] == "queued"
    cancel = await request("POST", f"{tasks}/queued/cancel", json={"expected_revision": 0})
    assert cancel.status_code == 200 and cancel.json()["status"] == "cancelled"
    for _ in range(2):
        retry = await request("POST", f"{tasks}/recoverable/retry-materialization")
        assert retry.status_code == 200, retry.text
        assert retry.json()["revision"] == 1
        assert retry.json()["status"] == "pending"
        assert retry.json()["provider_task_id"] == "accepted-once"
    batches = f"{root}/generation-batches"
    batch = await request("GET", f"{batches}/batch")
    assert batch.status_code == 200 and batch.json()["status"] == "processing"
    assert (await request("GET", batches)).json()["items"] == [batch.json()]


async def verify_visual_reviews(case, app, request, project_id):
    project = f"/v1/visual-workshop/projects/{project_id}/acceptance"
    snapshot = {
        "standard_version": 1,
        "standard_title": "Reference checks",
        "criteria": [
            {
                "id": "quality",
                "title": "Image quality",
                "requirement": "Keep details",
                "method": "manual",
                "required": True,
            },
        ],
        "output": {
            "id": "review-output",
            "kind": "text",
            "version": 1,
            "asset_id": None,
            "text": "draft",
            "title": "Output",
        },
        "coverage": "manual",
    }
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        session.add_all(
            [
                VisualNodeOutput(
                    id="review-output",
                    project_id=project_id,
                    node_id="review-node",
                    version=1,
                    kind="text",
                    text="draft",
                    source="uploaded",
                    source_key="review-fixture",
                ),
                AcceptanceStandardVersion(
                    id="standard-v1", project_id=project_id, version=1, document={}
                ),
            ]
        )
        await session.flush()
        for run_id, scheme, status in (
            ("completed", "motion-transfer:api", "completed"),
            ("queued-review", "motion-transfer:api", "queued"),
            ("legacy-review", "legacy", "completed"),
        ):
            session.add(
                AcceptanceRun(
                    id=run_id,
                    project_id=project_id,
                    node_id="review-node",
                    output_id="review-output",
                    standard_id="standard-v1",
                    request_id=run_id,
                    fingerprint="1" * 64,
                    scheme_id=scheme,
                    status=status,
                    snapshot=snapshot,
                    results=[
                        {
                            "criterion_id": "quality",
                            "verdict": "pending",
                            "explanation": "Original detail",
                            "origin": "manual",
                        }
                    ],
                )
            )
        await session.commit()
    runs = f"{project}/runs"
    listed = await request("GET", runs, params={"node_id": "review-node"})
    assert listed.status_code == 200, listed.text
    assert {item["id"] for item in listed.json()["items"]} == {
        "queued-review",
        "completed",
        "legacy-review",
    }
    legacy = await request("POST", f"{runs}/legacy-review/cancel", params={"expected_revision": 0})
    assert legacy.status_code == 409 and legacy.json()["code"] == "historical_readonly"
    cancelled = await request(
        "POST", f"{runs}/queued-review/cancel", params={"expected_revision": 0}
    )
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    body = {"criterion_id": "quality", "verdict": "failed", "reason": "Missing detail"}
    changed = await request(
        "POST", f"{runs}/completed/decisions", json={"expected_revision": 0, **body}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["decisions"][0]["actor"] == case.viewer
    stale = await request(
        "POST", f"{runs}/completed/decisions", json={"expected_revision": 0, **body}
    )
    assert stale.status_code == 409 and stale.json()["current"]["revision"] == 1
    finalized = await request(
        "POST", f"{runs}/completed/decisions", json={"expected_revision": 1, "finalize": True}
    )
    assert finalized.status_code == 200 and finalized.json()["decision"] == "failed"
    assert (await request("GET", f"{runs}/completed")).json() == finalized.json()
    repair = await request("POST", f"{runs}/completed/repair-drafts")
    assert repair.status_code == 200 and "Missing detail" in repair.json()["text"]
    saved = await request("GET", f"{project}/repair-drafts/{repair.json()['id']}")
    assert saved.status_code == 200 and saved.json() == repair.json()


async def verify_galgame_formats(case, app, request, projects):
    created = await request("POST", projects, json={"title": "Historical formats"})
    assert created.status_code == 200, created.text
    project = created.json()["id"]
    path = f"{projects}/{project}/story"
    original = (await request("GET", path)).json()
    raw = {**original["document"], "schemaVersion": "1.3"}
    encoded = b"\xef\xbb\xbf" + json.dumps(raw).encode()
    response = await request(
        "POST",
        path + "/import",
        data={"expectedRevision": "0"},
        files={"file": ("legacy.json", encoded, "application/json")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert response.json()["document"] == original["document"]
    stale = await request(
        "POST",
        path + "/import",
        data={"expectedRevision": "0"},
        files={"file": ("legacy.json", encoded, "application/json")},
    )
    assert stale.status_code == 409 and stale.json()["current"]["revision"] == 1
    invalid = await request(
        "POST",
        path + "/import",
        data={"expectedRevision": "1"},
        files={"file": ("invalid.json", b"not JSON", "application/json")},
    )
    assert invalid.status_code == 422 and invalid.json()["code"] == "invalid_story_document"

    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        story = await session.get(GalgameStoryDocument, project)
        story.document = raw
        stale_reference = GalgameProjectAssetReference(
            project_id=project, asset_id="isolated-stale"
        )
        session.add(stale_reference)
        await session.commit()
        reference_id = stale_reference.id
    migrations = "/v1/galgame-workshop/story-migrations"
    status = await request("GET", migrations + "/status")
    assert status.json() == {"pending": 1, "invalid": 0, "current": 1, "total": 2}
    blocked = await request("POST", migrations + "/run", json={"limit": 1})
    assert blocked.status_code == 503 and blocked.json()["code"] == "retention_unconfirmed"
    assert (await request("GET", path)).json()["revision"] == 1
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        await session.delete(await session.get(GalgameProjectAssetReference, reference_id))
        await session.commit()
    done = await request("POST", migrations + "/run", json={"limit": 1})
    assert done.status_code == 200, done.text
    assert done.json() == {
        "migrated": 1,
        "conflicts": 0,
        "invalid": 0,
        "remaining": 0,
        "current": 2,
        "total": 2,
    }
    assert (await request("POST", migrations + "/run", json={"limit": 1})).json()["migrated"] == 0
    current = await request("GET", path)
    assert current.json()["revision"] == 2
    assert current.json()["document"] == original["document"]


async def verify_galgame_files(case, app, request, path, story_asset):
    project_id = path.rsplit("/", 1)[1]
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        library = AssetLibrary(db, case.assets.state.settings)

        async def add_image(filename, **scope):
            return await library.store_upload(
                UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\n" + filename.encode()), filename=filename),
                owner_user_id=case.viewer,
                **scope,
            )

        project_file = await add_image("inventory.png", galgame_project_id=project_id)
        unretained = await add_image("unretained.png")
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        db.add(
            GalgameAssetMetadata(
                asset_id=project_file.id,
                project_id=project_id,
                category="cg",
                virtual_path="cg/inventory.png",
                packaging_policy="include",
                width=10,
                height=20,
            )
        )
        await db.commit()
    listing = await request("GET", path + "/assets", params={"query": " Invent "})
    assert listing.status_code == 200, listing.text
    assert [item["id"] for item in listing.json()["items"]] == [project_file.id]
    assert listing.json()["items"][0]["width"] == 10
    assert (await request("GET", path + "/assets", params={"query": "unretained"})).json() == {
        "items": []
    }
    overview_path = path + "/assets/overview"
    overview = await request("GET", overview_path)
    assert overview.status_code == 200, overview.text
    assert {item["id"] for item in overview.json()["items"]} == {project_file.id, story_asset}
    manifest = await request("GET", path + "/assets/package-manifest")
    assert manifest.status_code == 200, manifest.text
    assert manifest.json()["ready"]
    assert manifest.json()["items"] == [
        {
            "assetId": project_file.id,
            "virtualPath": "cg/inventory.png",
            "byteSize": project_file.byte_size,
            "reason": "forced",
        }
    ]
    preview = await request(
        "POST",
        path + "/assets/import-preview",
        json={"filenames": ["C:/incoming/inventory.png"], "category": "cg"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["items"][0]["virtualPath"] == "cg/inventory-2.png"
    query = GalgameAssetQuery(asset_ids=[unretained.id, case.asset, story_asset])
    target = query.path(project_id)
    grant = RequestGrant(
        "galgame", GALGAME_FILES_READ, "GET", overview_path, "assets", "POST", target
    )
    options = await authorize(case, "galgame", "GET", overview_path)
    client = app.state.capabilities
    token = await client.authorize_request(options[HEADER], grant)
    reply = await client.client.post(
        "http://assets:8080" + target, headers={HEADER: token}, json=query.model_dump()
    )
    assert reply.status_code == 200, reply.text
    assert {item["id"] for item in reply.json()} == {project_file.id, story_asset}
    tampered = await client.client.post(
        "http://assets:8080" + target, headers={HEADER: token}, json={"asset_ids": []}
    )
    assert tampered.status_code == 403
    assert (
        await request("GET", path.replace(project_id, "missing") + "/assets")
    ).status_code == 404
