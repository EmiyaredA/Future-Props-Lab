import httpx
import pytest
from tests.account_fixtures import account_record

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


@pytest.mark.asyncio
async def test_project_files_roundtrip_and_delete_removes_directory():
    from app.capabilities.asset_store.storage import AssetStorage
    from studio.config.settings import get_settings

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(ROOT, json={"title": "带文件"})
        project = created.json()
        url = f"{ROOT}/{project['id']}"
        uploaded = await client.post(f"{url}/files", files={"upload": ("model.bin", b"glb-bytes")})
        assert uploaded.status_code == 200, uploaded.text
        key = uploaded.json()["key"]
        fetched = await client.get(f"{url}/files/{key}")
        assert fetched.status_code == 200
        assert fetched.content == b"glb-bytes"
        empty = await client.post(f"{url}/files", files={"upload": ("empty.bin", b"")})
        assert empty.status_code == 422
        assert (await client.get(f"{url}/files/{'ab' * 32}")).status_code == 404
        document = {
            "format": "director-desk",
            "version": 3,
            "name": "带文件",
            "activeSceneId": "scene-main",
            "resources": [{"package": {"files": [{"path": "a.glb", "file": key}]}}],
            "scenes": [{"id": "scene-main", "name": "第一场"}],
        }
        saved = await client.patch(
            url, json={"title": "带文件", "expected_revision": 0, "document": document}
        )
        assert saved.status_code == 200, saved.text
        embedded = {
            **document,
            "resources": [{"package": {"files": [{"path": "a.glb", "data": "AAAA"}]}}],
        }
        rejected = await client.patch(
            url, json={"title": "带文件", "expected_revision": 1, "document": embedded}
        )
        assert rejected.status_code == 422
        root = AssetStorage(get_settings()).project_root(
            "director-desk", project["id"], owner_user_id="test-user"
        )
        assert (root / "files" / key).is_file()
        assert (await client.delete(url, params={"expected_revision": 1})).status_code == 200
        assert not root.exists()


@pytest.mark.asyncio
async def test_other_workspace_project_file_is_missing():
    from uuid import uuid4

    from app.runtime.db import SessionLocal
    from studio.apps.director_desk.storage.models import DirectorDeskProject

    project_id = str(uuid4())
    other = str(uuid4())
    async with SessionLocal() as session:
        session.add(account_record(id=other, name="隔离预演"))
        await session.flush()
        session.add(
            DirectorDeskProject(
                id=project_id,
                owner_user_id=other,
                title="隔离工程",
                document={
                    "format": "director-desk",
                    "version": 3,
                    "name": "隔离工程",
                    "resources": [],
                    "scenes": [],
                },
            )
        )
        await session.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"{ROOT}/{project_id}/files", files={"upload": ("secret.bin", b"secret")}
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_user_motion_library_replaces_embedded_bytes():
    motion_id = "user-motion:model-" + "cd" * 32 + ":0"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        uploaded = await client.post(
            "/v1/director-desk/library/files", files={"upload": ("clip.bin", b"motion")}
        )
        assert uploaded.status_code == 200, uploaded.text
        key = uploaded.json()["key"]
        body = {
            "motion": {
                "id": motion_id,
                "name": "行走",
                "duration": 1.2,
                "data": {"resourceId": "model-" + "cd" * 32},
            },
            "resource": {
                "id": "model-" + "cd" * 32,
                "package": {"files": [{"path": "a.glb", "file": key}]},
            },
        }
        saved = await client.put(f"/v1/director-desk/motions/{motion_id}", json=body)
        assert saved.status_code == 200, saved.text
        listed = (await client.get("/v1/director-desk/motions", params={"query": "行走"})).json()
        assert listed["items"][0]["name"] == "行走"
        loaded = (await client.get(f"/v1/director-desk/motions/{motion_id}")).json()
        assert loaded["resource"]["package"]["files"][0]["file"] == key
        assert (await client.get(f"/v1/director-desk/library/files/{key}")).content == b"motion"
        assert (await client.delete(f"/v1/director-desk/motions/{motion_id}")).status_code == 200
        assert (await client.get(f"/v1/director-desk/library/files/{key}")).status_code == 404
