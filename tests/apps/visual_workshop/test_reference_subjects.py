from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError

from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.outputs.references import resolve_references
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentPutIn,
    VisualCanvasVideoGenerationDraft,
)
from studio.apps.visual_workshop.snapshot_values import remap_canvas
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from studio.contracts.model_service.generation_tasks import VideoGenerationTaskCreateIn
from website_test_support import app


@pytest.mark.asyncio
async def test_subjects_follow_resolved_output_identity_and_keep_request_order():
    output = VisualNodeOutput(
        id="out",
        project_id="project",
        node_id="source",
        kind="image",
        asset_id="new-image",
        version=2,
        source="uploaded",
    )
    canvas = VisualCanvasDocument(
        project_id="project",
        revision=4,
        nodes=[
            {
                "id": "source",
                "kind": "image",
                "title": "手",
                "asset_id": "old-image",
                "final_output_id": "out",
            },
            {
                "id": "target",
                "kind": "video",
                "title": "镜头",
                "generation_draft": {
                    "reference_subjects": {"edge:linked": "hand", "asset:portrait": "person"},
                },
            },
        ],
        edges=[
            {
                "id": "linked",
                "source_node_id": "source",
                "target_node_id": "target",
                "binding": "final",
            }
        ],
    )
    db = AsyncMock()
    db.get.side_effect = lambda model, _identity: (
        canvas if model is VisualCanvasDocument else output
    )
    args = VideoGenerationTaskCreateIn(
        kind="video",
        model_id="model",
        mode="reference",
        canvas_node_id="target",
        expected_canvas_revision=4,
        reference_asset_ids=["portrait"],
        workflow_parameters={"video_subject_to_replace": "stale", "seed": 17},
    )
    resolved, _, _ = await resolve_references(db, "project", args, supports_subject=True)
    assert resolved.reference_asset_ids == ["portrait", "new-image"]
    assert resolved.workflow_parameters.video_subject_to_replace == "person, hand"
    assert resolved.workflow_parameters.seed == 17
    output.asset_id, output.version = "latest-image", 3
    changed, _, _ = await resolve_references(db, "project", args, supports_subject=True)
    assert changed.reference_asset_ids == ["portrait", "latest-image"]
    assert changed.workflow_parameters.video_subject_to_replace == "person, hand"
    canvas.nodes[1]["generation_draft"]["reference_order"] = ["edge:linked", "asset:portrait"]
    ordered, _, _ = await resolve_references(db, "project", args, supports_subject=True)
    assert ordered.reference_asset_ids == ["latest-image", "portrait"]
    assert ordered.workflow_parameters.video_subject_to_replace == "hand, person"
    canvas.nodes[1]["generation_draft"]["reference_subjects"] = {}
    cleared, _, _ = await resolve_references(db, "project", args, supports_subject=True)
    assert cleared.workflow_parameters.video_subject_to_replace == ""
    unsupported, _, _ = await resolve_references(db, "project", args)
    assert unsupported.workflow_parameters.video_subject_to_replace == "stale"


@pytest.mark.parametrize(
    "bindings", [{"asset:a": "右手"}, {"edge:x": "hand,person"}, {"wrong:x": "hand"}]
)
def test_rejects_invalid_tracking_bindings(bindings):
    with pytest.raises(ValidationError):
        VisualCanvasVideoGenerationDraft(reference_subjects=bindings)


def test_snapshot_remaps_asset_bindings_without_changing_edge_identity():
    canvas = VisualCanvasDocumentPutIn(
        expected_revision=0,
        nodes=[
            {
                "id": "source",
                "kind": "image",
                "title": "参考",
                "asset_id": "before",
                "position": {"x": 0, "y": 0},
            },
            {
                "id": "target",
                "kind": "video",
                "title": "镜头",
                "position": {"x": 300, "y": 0},
                "generation_draft": {
                    "reference_asset_ids": ["before"],
                    "reference_subjects": {"asset:before": "person", "edge:linked": "hand"},
                    "reference_order": ["edge:linked", "asset:before"],
                },
            },
        ],
        edges=[{"id": "linked", "source_node_id": "source", "target_node_id": "target"}],
    )
    nodes, _, _ = remap_canvas(canvas, {"before": "after"}, {}, {})
    draft = nodes[1]["generation_draft"]
    assert draft["reference_subjects"] == {"asset:after": "person", "edge:linked": "hand"}
    assert draft["reference_order"] == ["edge:linked", "asset:after"]


@pytest.mark.asyncio
async def test_canvas_preserves_bindings_for_old_clients_and_accepts_explicit_clear():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/visual-workshop/projects", json={"title": "目标绑定", "kind": "canvas"}
        )
        path = f"/v1/visual-workshop/projects/{created.json()['id']}/canvas"
        node = {
            "id": "target",
            "kind": "video",
            "title": "镜头",
            "position": {"x": 0, "y": 0},
            "generation_draft": {"reference_subjects": {"edge:linked": "hand"}},
        }
        saved = await client.put(path, json={"expected_revision": 0, "nodes": [node]})
        assert saved.is_success, saved.text
        node["generation_draft"] = {"prompt": "旧客户端修改提示词"}
        older = await client.put(path, json={"expected_revision": 1, "nodes": [node]})
        assert older.is_success, older.text
        assert older.json()["nodes"][0]["generation_draft"]["reference_subjects"] == {
            "edge:linked": "hand"
        }
        node["generation_draft"]["reference_subjects"] = {}
        clear = await client.put(path, json={"expected_revision": 2, "nodes": [node]})
        assert clear.is_success, clear.text
        assert clear.json()["nodes"][0]["generation_draft"]["reference_subjects"] == {}
