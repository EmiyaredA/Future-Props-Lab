"""Exercise persisted groups and the card-only project collection."""

from base64 import b64decode
from uuid import uuid4

import httpx
import pytest

from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
async def test_groups_and_project_cards_round_trip_through_canvas_cas():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base = "/v1/visual-workshop"
        project = await client.post(
            f"{base}/projects", json={"title": "编组验收", "kind": "canvas"}
        )
        assert project.is_success, project.text
        path = f"{base}/projects/{project.json()['id']}/canvas"
        card = await client.post(
            f"{base}/asset-cards", json={"title": "雨夜便利店", "kind": "scene"}
        )
        assert card.is_success, card.text
        card_id = card.json()["id"]
        nodes = [
            {"id": key, "kind": "text", "title": key, "position": {"x": index * 500, "y": 80}}
            for index, key in enumerate(("first", "second", "third"))
        ]
        group = {"id": "group-one", "title": "雨夜来信", "node_ids": ["first", "second"]}
        body = {
            "expected_revision": 0,
            "nodes": nodes,
            "groups": [group],
            "project_card_ids": [card_id],
        }
        stored = await client.put(path, json=body)
        assert stored.is_success, stored.text
        reread = await client.get(path)
        assert reread.json()["groups"] == [group]
        assert reread.json()["project_card_ids"] == [card_id]
        stale = await client.put(path, json=body)
        assert stale.status_code == 409
        overlapping = {"id": "group-two", "title": "重叠", "node_ids": ["first", "third"]}
        invalid = await client.put(
            path, json={**body, "expected_revision": 1, "groups": [group, overlapping]}
        )
        assert invalid.status_code == 422
        missing = await client.put(
            path, json={**body, "expected_revision": 1, "project_card_ids": [str(uuid4())]}
        )
        assert missing.status_code == 422
        older_client = await client.put(path, json={"expected_revision": 1, "nodes": nodes})
        assert older_client.is_success, older_client.text
        assert older_client.json()["groups"] == [group]
        assert older_client.json()["project_card_ids"] == [card_id]
        removed = await client.put(path, json={"expected_revision": 2, "nodes": nodes[1:]})
        assert removed.is_success, removed.text
        assert removed.json()["groups"] == []
        assert removed.json()["project_card_ids"] == [card_id]


@pytest.mark.asyncio
async def test_canvas_rejects_new_raw_nodes_in_reserved_design_categories():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base = "/v1/visual-workshop/projects"
        project = await client.post(base, json={"title": "分类验收", "kind": "canvas"})
        assert project.is_success, project.text
        path = f"{base}/{project.json()['id']}/canvas"
        for category in ("character", "scene", "prop"):
            invalid = await client.put(
                path,
                json={
                    "expected_revision": 0,
                    "categories": [{"id": category, "name": "素材", "groups": []}],
                    "nodes": [
                        {
                            "id": "raw",
                            "kind": "image",
                            "title": "旧式直接归类",
                            "category_id": category,
                            "position": {"x": 0, "y": 0},
                        }
                    ],
                },
            )
            assert invalid.status_code == 422, invalid.text
            assert "design_card_required" in invalid.text
        assert (await client.get(path)).json()["revision"] == 0


@pytest.mark.asyncio
async def test_legacy_node_manual_card_link_keeps_output_and_requires_matching_kind():
    png = b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base = "/v1/visual-workshop"
        created = await client.post(
            f"{base}/projects", json={"title": "旧素材关联验收", "kind": "canvas"}
        )
        project = created.json()["id"]
        path = f"{base}/projects/{project}"
        uploaded = await client.post(
            f"{path}/node-uploads",
            data={"expected_revision": 0, "x": 100, "y": 100},
            files={"file": ("legacy.png", png, "image/png")},
        )
        assert uploaded.is_success, uploaded.text
        legacy = {**uploaded.json()["nodes"][0], "category_id": "character"}
        # Fixture state from before reserved design categories were introduced.
        async with SessionLocal() as session:
            canvas = await session.get(VisualCanvasDocument, project)
            canvas.nodes = [legacy]
            await session.commit()

        assert (await client.get(f"{path}/canvas")).json()["project_card_ids"] == []
        for kind in ("scene", "character"):
            card = await client.post(
                f"{base}/asset-cards", json={"title": "现有设定", "kind": kind}
            )
            assert card.is_success, card.text
            identity = card.json()["id"]
            result = await client.put(
                f"{path}/canvas",
                json={
                    "expected_revision": uploaded.json()["revision"],
                    "nodes": [{**legacy, "design_card_id": identity}],
                    "project_card_ids": [identity],
                },
            )
            if kind == "scene":
                assert result.status_code == 422, result.text
            else:
                assert result.is_success, result.text
                assert result.json()["project_card_ids"] == [identity]
                linked = result.json()["nodes"][0]
                assert linked["design_card_id"] == identity
                assert linked["final_output_id"] == legacy["final_output_id"]
                assert linked["asset_id"] == legacy["asset_id"]
