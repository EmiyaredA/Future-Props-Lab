import copy

import httpx
import pytest
from tests.presentation_helpers import sample_document

from app.main import app


@pytest.mark.asyncio
async def test_presentation_batch_replay_conflict_and_atomic_validation():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post(
                "/v1/presentation-workshop/projects",
                json={
                    "title": "SDK batch",
                    "document": sample_document().model_dump(),
                },
            )
        ).json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        slide = project["document"]["slides"][0]
        body = {
            "expected_revision": 0,
            "request_id": "batch-1",
            "operations": [
                {
                    "entity": "slide",
                    "action": "update",
                    "id": slide["id"],
                    "value": {"notes": "SDK saved"},
                },
            ],
        }
        first = await client.post(url + "/operations", json=body)
        assert first.status_code == 200, first.text
        assert first.json()["revision"] == 1
        assert (await client.get(url)).json()["document"]["slides"][0]["notes"] == "SDK saved"
        replay = await client.post(url + "/operations", json=body)
        assert replay.status_code == 200 and replay.json() == first.json()
        changed = copy.deepcopy(body)
        changed["operations"][0]["value"]["notes"] = "different"
        assert (await client.post(url + "/operations", json=changed)).status_code == 409
        changed["request_id"] = "batch-2"
        assert (await client.post(url + "/operations", json=changed)).status_code == 409
        changed["expected_revision"] = 1
        changed["operations"].append(
            {"entity": "slide", "action": "update", "id": "missing", "value": {}}
        )
        assert (await client.post(url + "/operations", json=changed)).status_code == 404
        assert (await client.get(url)).json()["revision"] == 1
        assert (await client.delete(url, params={"expected_revision": 1})).status_code == 200
        assert (await client.post(url + "/operations", json=body)).status_code == 404


@pytest.mark.asyncio
async def test_visual_batch_preserves_node_edge_invariants():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/visual-workshop/projects", json={"title": "SDK canvas", "kind": "canvas"}
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = f"/v1/visual-workshop/projects/{project['id']}/canvas"
        current = (await client.get(url)).json()
        body = {
            "expected_revision": current["revision"],
            "request_id": "insert",
            "operations": [
                {
                    "entity": "node",
                    "action": "insert",
                    "id": "text-1",
                    "value": {
                        "kind": "text",
                        "title": "Instruction",
                        "text": "A scene",
                        "position": {"x": 0, "y": 0},
                    },
                },
            ],
        }
        changed = await client.post(url + "/operations", json=body)
        assert changed.status_code == 200, changed.text
        assert changed.json()["nodes"][0]["text"] == "A scene"
        assert (await client.post(url + "/operations", json=body)).json() == changed.json()


@pytest.mark.asyncio
async def test_galgame_block_edit_preserves_story_validation_and_replay():
    from tests.test_galgame_story_dialogue_patch import story_document

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "SDK Story"})
        ).json()
        url = f"/v1/galgame-workshop/projects/{project['id']}/story"
        initial = await client.put(url, json={"expected_revision": 0, "document": story_document()})
        assert initial.status_code == 200, initial.text
        body = {
            "expected_revision": 1,
            "request_id": "dialogue",
            "operations": [
                {
                    "entity": "block",
                    "action": "update",
                    "id": "block-dialogue",
                    "parent_id": "main",
                    "chapter_id": "chapter-1",
                    "value": {"text": "Updated by SDK"},
                },
            ],
        }
        result = await client.post(url + "/operations", json=body)
        assert result.status_code == 200, result.text
        assert result.json()["revision"] == 2
        assert (await client.post(url + "/operations", json=body)).json() == result.json()
        invalid = {
            "expected_revision": 2,
            "request_id": "referenced-character",
            "operations": [
                {"entity": "character", "action": "remove", "id": "character-one"},
            ],
        }
        assert (await client.post(url + "/operations", json=invalid)).status_code == 422
        assert (await client.get(url)).json()["revision"] == 2


@pytest.mark.asyncio
async def test_concurrent_duplicate_presentation_batch_has_one_revision():
    import asyncio

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post(
                "/v1/presentation-workshop/projects",
                json={"title": "Concurrent", "document": sample_document().model_dump()},
            )
        ).json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        body = {
            "expected_revision": 0,
            "request_id": "same-batch",
            "operations": [
                {
                    "entity": "slide",
                    "action": "update",
                    "id": "slide-one",
                    "value": {"notes": "single commit"},
                },
            ],
        }
        responses = await asyncio.gather(
            client.post(url + "/operations", json=body), client.post(url + "/operations", json=body)
        )
        assert [response.status_code for response in responses] == [200, 200]
        assert responses[0].json() == responses[1].json()
        assert (await client.get(url)).json()["revision"] == 1
