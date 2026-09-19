import httpx
import pytest

from app.main import app

ROOT = "/v1/director-desk/projects"


@pytest.mark.asyncio
async def test_create_rename_conflict_and_delete():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(ROOT, json={"title": "光影舞台"})
        assert created.status_code == 201, created.text
        project = created.json()
        assert project["revision"] == 0
        assert project["document"]["name"] == "光影舞台"
        assert project["document"]["scenes"] == []
        url = f"{ROOT}/{project['id']}"
        assert (await client.get(url)).json()["title"] == "光影舞台"
        missing = await client.patch(url, json={"title": "夜街"})
        assert missing.status_code == 422
        conflict = await client.patch(url, json={"title": "夜街", "expected_revision": 1})
        assert conflict.status_code == 409
        renamed = await client.patch(url, json={"title": "夜街", "expected_revision": 0})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["revision"] == 1
        assert renamed.json()["document"]["name"] == "夜街"
        listed = (await client.get(ROOT, params={"query": "夜街"})).json()
        assert listed["total"] == 1
        assert "document" not in listed["items"][0]
        assert (await client.delete(url, params={"expected_revision": 0})).status_code == 409
        assert (await client.delete(url, params={"expected_revision": 1})).status_code == 200
        assert (await client.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_scene_payload():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(ROOT, json={"title": "多余字段", "document": {}})
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_patch_keeps_scenes_and_rejects_embedded_files():
    scene = {
        "format": "director-desk",
        "version": 3,
        "name": "光影舞台",
        "activeSceneId": "scene-main",
        "resources": [],
        "scenes": [{"id": "scene-main", "name": "第一场"}],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(ROOT, json={"title": "光影舞台"})
        project = created.json()
        url = f"{ROOT}/{project['id']}"
        saved = await client.patch(
            url,
            json={"title": "光影舞台", "expected_revision": 0, "document": scene},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["document"]["scenes"][0]["id"] == "scene-main"
        renamed = await client.patch(url, json={"title": "夜街", "expected_revision": 1})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["document"]["name"] == "夜街"
        assert renamed.json()["document"]["scenes"][0]["id"] == "scene-main"
        embedded = {
            **scene,
            "resources": [{"files": [{"data": "A" * 20_000}]}],
        }
        rejected = await client.patch(
            url,
            json={"title": "夜街", "expected_revision": 2, "document": embedded},
        )
        assert rejected.status_code == 422
        mismatch = await client.patch(
            url,
            json={"title": "另一个名字", "expected_revision": 2, "document": scene},
        )
        assert mismatch.status_code == 422
