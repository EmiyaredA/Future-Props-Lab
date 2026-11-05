import sys
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from studio.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from website_test_support import app

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))

from future_props_lab import models  # noqa: E402


def text_node(index):
    return {
        "id": f"text-{index}",
        "kind": "text",
        "title": f"说明 {index}",
        "text": "保留参考历史",
        "position": {"x": index, "y": 0},
    }


def edge(source, target):
    return {
        "id": f"edge-{source}-{target}",
        "source_node_id": f"text-{source}",
        "target_node_id": f"text-{target}",
    }


def test_maximum_dependency_chain_and_late_cycle():
    nodes = [text_node(index) for index in range(1000)]
    edges = [edge(index, index + 1) for index in range(999)]
    document = VisualCanvasDocumentPutIn(expected_revision=0, nodes=nodes, edges=edges)
    assert len(document.nodes) == 1000
    with pytest.raises(ValidationError, match="不能形成依赖环"):
        VisualCanvasDocumentPutIn(expected_revision=0, nodes=nodes, edges=[*edges, edge(999, 0)])


def test_canvas_node_and_edge_limits_remain_bounded():
    nodes = [text_node(index) for index in range(1000)]
    edges = [edge(index, index + jump) for jump in (1, 2) for index in range(1000 - jump)]
    edges.extend(edge(index, index + 3) for index in range(3))
    assert len(edges) == 2000
    assert (
        len(VisualCanvasDocumentPutIn(expected_revision=0, nodes=nodes, edges=edges).edges) == 2000
    )
    with pytest.raises(ValidationError) as node_error:
        VisualCanvasDocumentPutIn(expected_revision=0, nodes=[*nodes, text_node(1000)])
    assert node_error.value.errors()[0]["loc"] == ("nodes",)
    assert node_error.value.errors()[0]["ctx"]["max_length"] == 1000
    with pytest.raises(ValidationError) as edge_error:
        VisualCanvasDocumentPutIn(expected_revision=0, nodes=nodes, edges=[*edges, edge(3, 6)])
    assert edge_error.value.errors()[0]["loc"] == ("edges",)
    assert edge_error.value.errors()[0]["ctx"]["max_length"] == 2000


def test_openapi_and_independent_sdk_share_canvas_capacity():
    schema = app.openapi()["components"]["schemas"]["VisualCanvasDocumentPutIn"]["properties"]
    sdk_schema = models.VisualCanvasDocumentPutIn.model_json_schema()["properties"]
    assert schema["nodes"]["maxItems"] == sdk_schema["nodes"]["maxItems"] == 1000
    sdk_edges = next(item for item in sdk_schema["edges"]["anyOf"] if item.get("type") == "array")
    assert schema["edges"]["maxItems"] == sdk_edges["maxItems"] == 2000
    sdk_document = models.VisualCanvasDocumentPutIn(
        expected_revision=0, nodes=[text_node(index) for index in range(1000)]
    )
    assert len(sdk_document.nodes) == 1000
    with pytest.raises(ValidationError):
        models.VisualCanvasDocumentPutIn(
            expected_revision=0, nodes=[text_node(index) for index in range(1001)]
        )


@pytest.mark.asyncio
async def test_large_canvas_operations_preserve_outputs_and_fail_atomically():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "大型返修保留历史", "kind": "canvas"}
        )
        assert project.status_code == 200, project.text
        base = f"/v1/visual-workshop/projects/{project.json()['id']}"
        uploaded = await client.post(
            "/v1/files",
            data={"project_id": project.json()["id"]},
            files={"upload": ("reference.png", b"\x89PNG\r\n\x1a\nreference", "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        nodes = [
            {
                "id": "reference",
                "kind": "image",
                "title": "既有人设版本",
                "position": {"x": 0, "y": 0},
                "asset_id": uploaded.json()["id"],
            },
            *[text_node(index) for index in range(499)],
        ]
        initial = await client.put(f"{base}/canvas", json={"expected_revision": 0, "nodes": nodes})
        assert initial.status_code == 200, initial.text
        history_url = f"{base}/nodes/reference/outputs"
        history = (await client.get(history_url)).json()
        assert history["total"] == 1
        body = {
            "expected_revision": initial.json()["revision"],
            "request_id": "preserve-large-canvas",
            "operations": [
                {"entity": "node", "action": "insert", "id": f"text-{i}", "value": text_node(i)}
                for i in range(499, 999)
            ],
        }
        expanded = await client.post(f"{base}/canvas/operations", json=body)
        assert expanded.status_code == 200, expanded.text
        before = expanded.json()
        assert len(before["nodes"]) == 1000
        assert before["nodes"][:500] == initial.json()["nodes"]
        assert (await client.post(f"{base}/canvas/operations", json=body)).json() == before
        assert (await client.get(history_url)).json() == history

        rejected = await client.post(
            f"{base}/canvas/operations",
            json={
                "expected_revision": before["revision"],
                "request_id": "one-node-too-many",
                "operations": [
                    {
                        "entity": "node",
                        "action": "update",
                        "id": "text-0",
                        "value": {"text": "不得部分保存"},
                    },
                    {
                        "entity": "node",
                        "action": "insert",
                        "id": "text-999",
                        "value": text_node(999),
                    },
                ],
            },
        )
        assert rejected.status_code == 422, rejected.text
        assert rejected.json()["code"] == "invalid_operation_result"
        assert (await client.get(f"{base}/canvas")).json() == before
        assert (await client.get(history_url)).json() == history
        overflow = await client.put(
            f"{base}/canvas",
            json={
                "expected_revision": before["revision"],
                "nodes": [*before["nodes"], text_node(999)],
            },
        )
        assert overflow.status_code == 422
        assert (await client.get(f"{base}/canvas")).json() == before
