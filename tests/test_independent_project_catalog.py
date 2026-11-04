"""Published project roots work without any access to the Assets database."""

import io
import json
import wave
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
            voice_id = await verify_voice_match(case, app, request, path)
            replacement_id = await verify_galgame_asset_repair(case, request, path, voice_id)
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
                    AssetReferenceSet.resource_id == record["id"],
                )
            )
            assert set(pins) == {asset_id, replacement_id, voice_id}


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
    await verify_visual_output_writes(case, request, path, asset.id, output)

    await app.state.reference_delivery.process_once()
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        pins = await session.scalars(
            select(AssetReferencePin.asset_id)
            .join(AssetReferenceSet, AssetReferenceSet.id == AssetReferencePin.reference_set_id)
            .where(
                AssetReferenceSet.service_id == "visual",
                AssetReferenceSet.resource_kind == "canvas",
                AssetReferenceSet.resource_revision == 6,
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
    repair_path = f"{project}/repair-drafts/{repair.json()['id']}"
    plain = await request(
        "PUT", repair_path, json={"expected_revision": 0, "text": "Refine the lighting"}
    )
    assert plain.status_code == 200, plain.text
    assert plain.json()["revision"] == 1 and plain.json()["prompt_version_id"] is None
    canvas_path = f"/v1/visual-workshop/projects/{project_id}/canvas"
    canvas = (await request("GET", canvas_path)).json()
    node = {
        "id": "review-node",
        "kind": "image",
        "title": "Repair target",
        "position": {"x": 0, "y": 0},
        "generation_draft": {"prompt": "Original prompt"},
    }
    added = await request(
        "PUT",
        canvas_path,
        json={"expected_revision": canvas["revision"], "nodes": [*canvas["nodes"], node]},
    )
    assert added.status_code == 200, added.text
    apply = {"expected_revision": 1, "text": "Preserve the scene", "apply": True}
    refused = await request(
        "PUT", repair_path, json={**apply, "expected_canvas_revision": canvas["revision"]}
    )
    assert refused.status_code == 409, refused.text
    assert (await request("GET", repair_path)).json() == plain.json()
    applied = await request(
        "PUT", repair_path, json={**apply, "expected_canvas_revision": added.json()["revision"]}
    )
    assert applied.status_code == 200, applied.text
    prompt_id = applied.json()["prompt_version_id"]
    assert applied.json()["revision"] == 2 and prompt_id
    current = (await request("GET", canvas_path)).json()
    assert current["revision"] == added.json()["revision"] + 1
    updated = next(item for item in current["nodes"] if item["id"] == node["id"])
    assert updated["generation_draft"]["active_prompt_version_id"] == prompt_id
    assert updated["generation_draft"]["prompt"] == apply["text"]
    repeated = await request(
        "PUT",
        repair_path,
        json={**apply, "expected_revision": 2, "expected_canvas_revision": current["revision"]},
    )
    assert repeated.status_code == 409 and repeated.json()["code"] == "already_applied"


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

    project_path = f"{projects}/{project}"
    renamed = await request(
        "PATCH", project_path, json={"expected_revision": 0, "title": "Verified title"}
    )
    assert renamed.status_code == 200 and renamed.json()["revision"] == 1
    stale_title = await request(
        "PATCH", project_path, json={"expected_revision": 0, "title": "Stale title"}
    )
    assert stale_title.status_code == 409 and stale_title.json()["current"] == renamed.json()

    story = current.json()["document"]
    main = story["chapters"][0]["fragments"][0]
    main["blocks"] = [{"id": "reenter", "type": "returnToEntry"}]
    loop = await request("PUT", path, json={"expected_revision": 2, "document": story})
    assert loop.status_code == 200, loop.text
    report = await request("GET", path + "/report")
    assert report.status_code == 200 and not report.json()["ready"], report.text
    completion = {"expected_revision": 1, "status": "completed"}
    refused = await request("PATCH", project_path, json=completion)
    assert refused.status_code == 422 and refused.json()["code"] == "story_not_ready"
    assert refused.json()["report"] == report.json()
    main["blocks"] = [{"id": "ending", "type": "endChapter"}]
    repaired = await request("PUT", path, json={"expected_revision": 3, "document": story})
    assert repaired.status_code == 200, repaired.text
    validated = await request("GET", path + "/report")
    assert validated.status_code == 200 and validated.json()["ready"], validated.text
    completed = await request("PATCH", project_path, json=completion)
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed" and completed.json()["revision"] == 2
    edited = await request("PUT", path, json={"expected_revision": 4, "document": story})
    assert edited.status_code == 200, edited.text
    reopened = await request("GET", project_path)
    assert reopened.json()["status"] == "draft" and reopened.json()["revision"] == 3


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


async def verify_voice_match(case, app, request, path):
    project_id = path.rsplit("/", 1)[1]
    content = io.BytesIO()
    with wave.open(content, "wb") as audio:
        audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\x00" * 1600)
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        asset = await AssetLibrary(db, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(content.getvalue()), filename="voice.wav"),
            owner_user_id=case.viewer,
            galgame_project_id=project_id,
        )
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        db.add(
            GalgameAssetMetadata(
                asset_id=asset.id,
                project_id=project_id,
                category="voice",
                virtual_path="voice/voice.wav",
                duration_ms=100,
            )
        )
        await db.commit()
    transcript = f"{path}/assets/{asset.id}/transcript"
    text = {"expectedRevision": 0, "text": "  Initial  ", "language": "zh"}
    foreign = await request("PATCH", transcript.replace(asset.id, case.asset), json=text)
    assert foreign.status_code == 404
    written = await request("PATCH", transcript, json=text)
    assert written.status_code == 200, written.text
    assert written.json() == {
        "assetId": asset.id,
        "transcript": "Initial",
        "language": "zh",
        "source": "manual",
        "revision": 1,
    }
    conflict = await request("PATCH", transcript, json={**text, "text": "Stale"})
    assert conflict.status_code == 409 and conflict.json()["current"]["transcript"] == "Initial"
    story = await request("GET", path + "/story")
    body = {
        "expectedStoryRevision": story.json()["revision"],
        "assetIds": [asset.id],
        "blockIds": ["line"],
    }
    matched = await request("POST", path + "/assets/asr/match-dialogue", json=body)
    assert matched.status_code == 200, matched.text
    assert matched.json()["matches"] == [
        {"assetId": asset.id, "blockId": "line", "similarity": 1.0}
    ]
    saved = await request("GET", path + "/story")
    assert (
        saved.json()["revision"] == matched.json()["storyRevision"] == story.json()["revision"] + 1
    )
    scene = saved.json()["document"]["chapters"][0]["fragments"][0]
    assert scene["blocks"][0]["voiceAssetId"] == f"voice-{asset.id}"
    stale = await request("POST", path + "/assets/asr/match-dialogue", json=body)
    assert (
        stale.status_code == 409 and stale.json()["current"]["revision"] == saved.json()["revision"]
    )
    return asset.id


async def verify_visual_output_writes(case, request, path, previous_asset, previous_output):
    outputs = path + "/nodes/node/outputs"
    denied = await request(
        "POST", outputs, json={"expected_revision": 3, "asset_id": previous_asset}
    )
    assert denied.status_code == 404, denied.text
    project_id = path.rsplit("/", 1)[1]
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        current_asset = await AssetLibrary(db, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\nnew output"), filename="new-output.png"),
            owner_user_id=case.viewer,
            visual_project_id=project_id,
        )
    added = await request(
        "POST", outputs, json={"expected_revision": 3, "asset_id": current_asset.id}
    )
    assert added.status_code == 200, added.text
    node = added.json()["nodes"][0]
    assert added.json()["revision"] == 4 and node["asset_id"] == current_asset.id
    assert node["final_version"] == 2 and node["final_output_id"] != previous_output
    switch = path + "/nodes/node/final-output"
    stale = await request(
        "PUT", switch, json={"expected_revision": 3, "output_id": previous_output}
    )
    assert stale.status_code == 409 and stale.json()["current"]["revision"] == 4
    selected = await request(
        "PUT", switch, json={"expected_revision": 4, "output_id": previous_output}
    )
    assert selected.status_code == 200, selected.text
    node = selected.json()["nodes"][0]
    assert selected.json()["revision"] == 5 and node["asset_id"] == previous_asset
    assert node["final_version"] == 1 and node["output_sequence"] == 2
    history = await request("GET", outputs)
    assert [(item["version"], item["is_final"]) for item in history.json()["items"]] == [
        (2, False),
        (1, True),
    ]
    newest = history.json()["items"][0]["id"]
    removal = outputs + "/" + newest
    stale = await request("DELETE", removal, params={"expected_revision": 4})
    assert stale.status_code == 409, stale.text
    removed = await request("DELETE", removal, params={"expected_revision": 5})
    assert removed.status_code == 200, removed.text
    assert removed.json()["revision"] == 6
    assert removed.json()["nodes"][0]["final_output_id"] == previous_output
    assert removed.json()["nodes"][0]["output_sequence"] == 2
    assert (await request("GET", removal)).status_code == 404


async def verify_galgame_asset_repair(case, request, path, voice_id):
    story_path = path + "/story"
    original = (await request("GET", story_path)).json()
    repair = path + "/assets/repair"
    body = {
        "expectedStoryRevision": original["revision"],
        "storyAssetId": "fixture-image",
        "replacementFileId": case.asset,
    }
    response = await request("POST", repair, json=body)
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    response = await request("POST", repair, json={**body, "replacementFileId": voice_id})
    assert response.status_code == 422 and response.json()["code"] == "media_kind_mismatch"
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        library = AssetLibrary(db, case.assets.state.settings)
        other = await library.store_upload(
            UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\nother project"), filename="other.png"),
            owner_user_id=case.viewer,
            galgame_project_id="other-project",
        )
        assert (
            await request("POST", repair, json={**body, "replacementFileId": other.id})
        ).status_code == 404
        replacement = await library.store_upload(
            UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\nreplacement"), filename="repair.png"),
            owner_user_id=case.viewer,
        )
    request_body = {**body, "replacementFileId": replacement.id}
    missing = await request("POST", repair, json={**request_body, "storyAssetId": "unknown"})
    assert missing.status_code == 404 and missing.json()["code"] == "story_asset_not_found"
    assert (await request("GET", story_path)).json() == original
    response = await request("POST", repair, json=request_body)
    assert response.status_code == 200, response.text
    repaired = response.json()
    assert repaired["revision"] == original["revision"] + 1
    item = next(item for item in repaired["document"]["assets"] if item["id"] == "fixture-image")
    assert item["fileId"] == replacement.id
    stale = await request("POST", repair, json=request_body)
    assert stale.status_code == 409 and stale.json()["current"] == repaired
    return replacement.id


async def verify_galgame_portrait_upgrade(case, app, request, prefix):
    created = await request("POST", prefix, json={"title": "Portrait fixture"})
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    story_path = f"{prefix}/{project_id}/story"
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        file = await AssetLibrary(db, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(b"\x89PNG\r\n\x1a\nportrait"), filename="actor.png"),
            owner_user_id=case.viewer,
            galgame_project_id=project_id,
        )
    async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        db.add(
            GalgameAssetMetadata(
                asset_id=file.id,
                project_id=project_id,
                category="character",
                virtual_path="character/actor.png",
                width=200,
                height=540,
            )
        )
        await db.commit()
    document = (await request("GET", story_path)).json()["document"]
    document["assets"] = [
        {
            "id": "actor",
            "fileId": file.id,
            "role": "characterPortrait",
            "type": "image",
            "status": "ready",
        }
    ]
    document["characters"] = [
        {
            "id": "actor",
            "name": "Actor",
            "expressions": [
                {
                    "id": "neutral",
                    "label": "Neutral",
                    "assetId": "actor",
                    "heightPercent": 80.0,
                }
            ],
        }
    ]
    response = await request("PUT", story_path, json={"expected_revision": 0, "document": document})
    assert response.status_code == 200, response.text
    path = story_path + "/portrait-upgrade"
    preview = await request("GET", path)
    assert preview.status_code == 200, preview.text
    item = preview.json()["items"][0]
    assert item["currentHeightPercent"] == 80.0
    target = item["targetHeightPercent"]
    assert target == round(
        540 / response.json()["document"]["settings"]["canvas"]["height"] * 100, 4
    )
    applied = await request("POST", path, json={"expectedStoryRevision": 1})
    assert applied.status_code == 200, applied.text
    assert applied.json()["revision"] == 2
    assert applied.json()["document"]["characters"][0]["expressions"][0]["heightPercent"] == target
    stale = await request("POST", path, json={"expectedStoryRevision": 1})
    assert stale.status_code == 409 and stale.json()["current"] == applied.json()
    snapshots = (await request("GET", story_path + "/snapshots")).json()
    assert len(snapshots) == 1
    assert snapshots[0]["storyRevision"] == 1 and snapshots[0]["reason"] == "portrait-size-upgrade"
    restored = await request(
        "POST",
        f"{story_path}/snapshots/{snapshots[0]['id']}/restore",
        json={"expectedStoryRevision": 2},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["document"] == response.json()["document"]
