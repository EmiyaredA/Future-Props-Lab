import httpx
import pytest

from app.main import app


@pytest.mark.asyncio
async def test_metadata_only_canvas_put_cannot_delete_graph_or_outputs():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "画板防误清空", "kind": "canvas"}
        )
        assert project.status_code == 200, project.text
        base = f"/v1/visual-workshop/projects/{project.json()['id']}"
        uploaded = await client.post(
            "/v1/files",
            data={"project_id": project.json()["id"]},
            files={"upload": ("reference.png", b"\x89PNG\r\n\x1a\nreference", "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        response = await client.put(
            f"{base}/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {
                        "id": "reference",
                        "kind": "image",
                        "title": "参考图",
                        "position": {"x": 0, "y": 0},
                        "asset_id": uploaded.json()["id"],
                    },
                    {
                        "id": "draft",
                        "kind": "image",
                        "title": "草稿",
                        "position": {"x": 400, "y": 0},
                    },
                ],
                "edges": [
                    {"id": "input", "source_node_id": "reference", "target_node_id": "draft"}
                ],
            },
        )
        assert response.status_code == 200, response.text
        before = response.json()
        outputs_url = f"{base}/nodes/reference/outputs"
        outputs = (await client.get(outputs_url)).json()
        assert outputs["total"] == 1

        # An SDK caller updating only categories must explicitly include the graph.
        rejected = await client.put(
            f"{base}/canvas",
            json={
                "expected_revision": before["revision"],
                "categories": [{"id": "storyboard", "name": "分镜", "groups": ["新分组"]}],
            },
        )
        assert rejected.status_code == 422, rejected.text
        assert (await client.get(f"{base}/canvas")).json() == before
        assert (await client.get(outputs_url)).json() == outputs

        updated = await client.put(
            f"{base}/canvas",
            json={
                "expected_revision": before["revision"],
                "nodes": before["nodes"],
                "edges": before["edges"],
                "categories": [{"id": "storyboard", "name": "分镜", "groups": ["新分组"]}],
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["nodes"] == before["nodes"]
        assert updated.json()["edges"] == before["edges"]
        assert (await client.get(outputs_url)).json() == outputs

        # Explicit empty graphs still support deliberate deletion with CAS.
        cleared = await client.put(
            f"{base}/canvas",
            json={"expected_revision": updated.json()["revision"], "nodes": [], "edges": []},
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["nodes"] == cleared.json()["edges"] == []
        assert (await client.get(f"/v1/files/{uploaded.json()['id']}/content")).status_code == 200
