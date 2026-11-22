"""Project image registration is atomic, scoped, idempotent and repairable."""

import asyncio
from io import BytesIO
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from studio.apps.visual_workshop.outputs.queries import OutputError
from studio.apps.visual_workshop.project_reference_rules import require_project_design_references
from studio.apps.visual_workshop.storage.reference_images import SqlReferenceImages
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal, app

BASE = "/v1/visual-workshop"


async def project(client):
    response = await client.post(
        BASE + "/projects", json={"title": "参考图片登记", "kind": "canvas"}
    )
    assert response.is_success, response.text
    return BASE + "/projects/" + response.json()["id"]


async def image(client, path, color="blue"):
    buffer = BytesIO()
    Image.new("RGB", (12, 12), color).save(buffer, "PNG")
    response = await client.post(
        "/v1/files",
        data={"project_id": path.rsplit("/", 1)[-1]},
        files={"upload": ("参考.png", buffer.getvalue(), "image/png")},
    )
    assert response.is_success, response.text
    return response.json()["id"]


def registration(asset, revision=0, kind="character", **patch):
    return {
        "request_id": str(uuid4()),
        "expected_revision": revision,
        "asset_id": asset,
        "kind": kind,
        "title": "新参考设定",
        **patch,
    }


@pytest.mark.parametrize("kind", ["character", "scene", "prop"])
async def test_registration_creates_card_membership_and_receipt_together(kind):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = await project(client)
        asset = await image(client, path)
        body = registration(asset, kind=kind)
        created = await client.post(path + "/reference-images", json=body)
        assert created.is_success, created.text
        result = created.json()
        card = result["card"]
        assert card["kind"] == kind and card["adopted_asset_id"] == asset
        assert card["parent_id"] is None and result["reused"] is False
        assert result["project_card_ids"] == [card["id"]] and result["revision"] == 1
        assert (await client.get(path + "/asset-cards")).json() == [card]
        canvas = (await client.get(path + "/canvas")).json()
        assert canvas["nodes"] == [] and canvas["project_card_ids"] == [card["id"]]
        replay = await client.post(
            path + "/reference-images", json={**body, "expected_revision": 1}
        )
        assert replay.is_success and replay.json()["card"]["id"] == card["id"]
        assert replay.json()["revision"] == 1
        conflicting = await client.post(
            path + "/reference-images", json={**body, "kind": "prop" if kind != "prop" else "scene"}
        )
        assert conflicting.status_code == 409
        assert len((await client.get(path + "/asset-cards")).json()) == 1


async def test_exact_content_reuses_only_current_project_cards_and_stale_cas_never_creates():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = await project(client)
        original = await image(client, path)
        outside = await client.post(
            BASE + "/asset-cards",
            json={"kind": "character", "title": "账号库未收录", "adopted_asset_id": original},
        )
        assert outside.is_success
        assert (await client.get(path + "/asset-cards")).json() == []
        first = await client.post(path + "/reference-images", json=registration(original))
        assert first.is_success, first.text
        assert first.json()["card"]["id"] != outside.json()["id"]
        duplicate = await image(client, path)
        reused = await client.post(path + "/reference-images", json=registration(duplicate, 1))
        assert reused.is_success and reused.json()["reused"] is True
        assert reused.json()["card"]["id"] == first.json()["card"]["id"]
        assert reused.json()["revision"] == 1
        fresh = await image(client, path, "red")
        stale = await client.post(path + "/reference-images", json=registration(fresh))
        assert stale.status_code == 409 and stale.json()["current"]["revision"] == 1
        assert len((await client.get(path + "/asset-cards")).json()) == 1


async def test_multiple_project_matches_require_explicit_choice_and_keep_original_cards():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = await project(client)
        asset = await image(client, path)
        cards = []
        for title in ["同图角色一", "同图角色二"]:
            response = await client.post(
                BASE + "/asset-cards",
                json={"kind": "character", "title": title, "adopted_asset_id": asset},
            )
            assert response.is_success
            cards.append(response.json())
        saved = await client.put(
            path + "/canvas",
            json={
                "expected_revision": 0,
                "nodes": [],
                "project_card_ids": [card["id"] for card in cards],
            },
        )
        assert saved.is_success
        body = registration(asset, 1)
        ambiguous = await client.post(path + "/reference-images", json=body)
        assert (
            ambiguous.status_code == 409
            and ambiguous.json()["code"] == "reference_image_choice_required"
        )
        chosen = await client.post(
            path + "/reference-images", json={**body, "reuse_card_id": cards[1]["id"]}
        )
        assert chosen.is_success, chosen.text
        assert chosen.json()["card"] == cards[1]
        assert chosen.json()["revision"] == 1
        assert len((await client.get(path + "/asset-cards")).json()) == 2


async def test_foreign_project_and_unavailable_identity_cannot_create_cards(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path, other = await project(client), await project(client)
        asset = await image(client, other)
        rejected = await client.post(path + "/reference-images", json=registration(asset))
        assert rejected.status_code == 422
        own = await image(client, path)

        async def unavailable(*_args):
            return None

        monkeypatch.setattr(app.state, "reference_image_identity", unavailable)
        failed = await client.post(path + "/reference-images", json=registration(own))
        assert failed.status_code == 503
        assert (await client.get(path + "/asset-cards")).json() == []
        assert (await client.get(path + "/canvas")).json()["revision"] == 0
        async with SessionLocal() as session:
            with pytest.raises(ProjectResourceError):
                await SqlReferenceImages(session, "different-account").require_project(
                    path.rsplit("/", 1)[-1]
                )


async def test_new_references_require_collection_and_historical_references_remain_repairable():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = await project(client)
        asset = await image(client, path)
        response = await client.post(
            BASE + "/asset-cards",
            json={"kind": "character", "title": "历史参考", "adopted_asset_id": asset},
        )
        card = response.json()
        nodes = [
            {
                "id": "target",
                "kind": "video",
                "title": "镜头",
                "position": {"x": 0, "y": 0},
                "generation_draft": {
                    "mode": "reference",
                    "reference_asset_ids": [asset],
                    "design_references": [
                        {
                            "card_id": card["id"],
                            "card_revision": card["revision"],
                            "asset_id": asset,
                            "title": card["title"],
                        }
                    ],
                },
            }
        ]
        body = {"expected_revision": 0, "nodes": nodes, "edges": []}
        failed = await client.put(path + "/canvas", json=body)
        assert failed.status_code == 422 and failed.json()["code"] == "project_card_required"
        saved = await client.put(path + "/canvas", json={**body, "project_card_ids": [card["id"]]})
        assert saved.is_success, saved.text
        historical = await client.put(
            path + "/canvas", json={**body, "expected_revision": 1, "project_card_ids": []}
        )
        assert historical.is_success, historical.text
        assert historical.json()["nodes"][0]["generation_draft"]["design_references"]
        async with SessionLocal() as session:
            with pytest.raises(OutputError) as issue:
                await require_project_design_references(session, path.rsplit("/", 1)[-1], "target")
            assert issue.value.code == "project_card_required"
        repaired = await client.put(
            path + "/canvas",
            json={**body, "expected_revision": 2, "project_card_ids": [card["id"]]},
        )
        assert repaired.is_success
        async with SessionLocal() as session:
            await require_project_design_references(session, path.rsplit("/", 1)[-1], "target")


async def test_competing_registrations_retry_without_duplicate_cards():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = await project(client)
        first, second = await image(client, path), await image(client, path)
        bodies = [registration(first), registration(second)]
        replies = await asyncio.gather(
            *(client.post(path + "/reference-images", json=body) for body in bodies)
        )
        assert sorted(reply.status_code for reply in replies) == [200, 409]
        retry_body = bodies[
            next(index for index, reply in enumerate(replies) if reply.status_code == 409)
        ]
        retried = await client.post(
            path + "/reference-images", json={**retry_body, "expected_revision": 1}
        )
        assert retried.is_success and retried.json()["reused"]
        assert len((await client.get(path + "/asset-cards")).json()) == 1
