import httpx
import pytest

from app.main import app


def story_document() -> dict:
    return {
        "schemaVersion": "1.4",
        "entryChapterId": "chapter-1",
        "synopsis": "保留未修改内容。",
        "characters": [{"id": "character-one", "name": "调查员"}],
        "scenes": [],
        "variables": [],
        "assets": [],
        "chapters": [
            {
                "id": "chapter-1",
                "title": "第一章",
                "order": 1,
                "entryFragmentId": "main",
                "fragments": [
                    {
                        "id": "main",
                        "title": "快速保存",
                        "blocks": [
                            {
                                "id": "block-dialogue",
                                "type": "dialogue",
                                "characterId": "character-one",
                                "text": "原始对白。",
                            },
                            {
                                "id": "block-show-character",
                                "type": "showCharacter",
                                "characterId": "character-one",
                            },
                            {
                                "id": "block-stage-cast",
                                "type": "setStageCast",
                                "members": [{"characterId": "character-one"}],
                            },
                        ],
                    }
                ],
            }
        ],
    }


@pytest.mark.asyncio
async def test_patches_one_dialogue_without_returning_the_full_document() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "快速保存"})
        ).json()
        created = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": story_document()},
        )
        assert created.status_code == 200, created.text

        patched = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/story/dialogue",
            json={
                "expected_revision": 1,
                "fragmentId": "main",
                "blockId": "block-dialogue",
                "text": "只保存这一句。",
                "expressionId": None,
                "portrait": {
                    "mode": "stage",
                    "visible": True,
                    "distance": "near",
                    "keepAfter": True,
                },
            },
        )
        assert patched.status_code == 200, patched.text
        payload = patched.json()
        assert "document" not in payload
        assert payload["revision"] == 2
        assert payload["block"]["text"] == "只保存这一句。"
        assert payload["block"]["content"] == {
            "version": 1,
            "nodes": [{"type": "text", "text": "只保存这一句。"}],
        }
        assert payload["block"]["portrait"]["distance"] == "near"

        story = (await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story")).json()
        assert story["revision"] == 2
        assert story["document"]["synopsis"] == story_document()["synopsis"]
        assert story["document"]["chapters"][0]["fragments"][0]["blocks"][0] == payload["block"]

        stale = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/story/dialogue",
            json={
                "expected_revision": 1,
                "fragmentId": "main",
                "blockId": "block-dialogue",
                "text": "过期修改",
                "expressionId": None,
                "portrait": None,
            },
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"
        assert stale.json()["current"]["revision"] == 2

        stage_expression = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/story/stage-expression",
            json={
                "expected_revision": 2,
                "fragmentId": "main",
                "blockId": "block-show-character",
                "characterId": "character-one",
                "expressionId": None,
            },
        )
        assert stage_expression.status_code == 200, stage_expression.text
        assert "document" not in stage_expression.json()
        assert stage_expression.json()["revision"] == 3
        assert stage_expression.json()["block"]["type"] == "showCharacter"

        stage_cast_expression = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/story/stage-expression",
            json={
                "expected_revision": 3,
                "fragmentId": "main",
                "blockId": "block-stage-cast",
                "characterId": "character-one",
                "expressionId": None,
            },
        )
        assert stage_cast_expression.status_code == 200, stage_cast_expression.text
        assert stage_cast_expression.json()["revision"] == 4
        assert stage_cast_expression.json()["block"]["type"] == "setStageCast"
