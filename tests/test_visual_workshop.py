from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

import app.deps as deps
from app.core.credentials import encrypt_secret
from app.core.db import SessionLocal
from app.main import app
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
    VisualAssetFolder,
    VisualGenerationTask,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)


@pytest.mark.asyncio
async def test_visual_workshop_project_crud_validation_sorting_and_conflicts() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(VisualWorkshopProject))
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        empty = await client.get("/v1/visual-workshop/projects")
        assert empty.status_code == 200
        assert empty.json() == {"items": []}

        image = await client.post(
            "/v1/visual-workshop/projects",
            json={"title": "  产品主视觉  ", "kind": "image"},
        )
        assert image.status_code == 200, image.text
        first = image.json()
        assert first["title"] == "产品主视觉"
        assert first["status"] == "draft"
        assert first["revision"] == 0

        canvas = await client.get(f"/v1/visual-workshop/projects/{first['id']}/canvas")
        assert canvas.status_code == 200
        assert canvas.json()["nodes"] == []
        assert canvas.json()["revision"] == 0

        saved_canvas = await client.put(
            f"/v1/visual-workshop/projects/{first['id']}/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {
                        "id": "text-1",
                        "kind": "text",
                        "title": "文本1",
                        "position": {"x": 120, "y": 80},
                        "text": "灵感草稿",
                    }
                ],
            },
        )
        assert saved_canvas.status_code == 200, saved_canvas.text
        assert saved_canvas.json()["revision"] == 1
        assert saved_canvas.json()["nodes"][0]["text"] == "灵感草稿"

        stale_canvas = await client.put(
            f"/v1/visual-workshop/projects/{first['id']}/canvas",
            json={"expected_revision": 0, "nodes": []},
        )
        assert stale_canvas.status_code == 409
        assert stale_canvas.json()["current"]["nodes"][0]["id"] == "text-1"

        duplicate_nodes = await client.put(
            f"/v1/visual-workshop/projects/{first['id']}/canvas",
            json={
                "expected_revision": 1,
                "nodes": [
                    {
                        "id": "duplicate",
                        "kind": "text",
                        "title": "文本1",
                        "position": {"x": 0, "y": 0},
                        "text": "",
                    },
                    {
                        "id": "duplicate",
                        "kind": "text",
                        "title": "文本2",
                        "position": {"x": 20, "y": 20},
                        "text": "",
                    },
                ],
            },
        )
        assert duplicate_nodes.status_code == 422

        video = await client.post(
            "/v1/visual-workshop/projects",
            json={"title": "宣传视频", "kind": "video"},
        )
        second = video.json()
        listed = (await client.get("/v1/visual-workshop/projects")).json()["items"]
        assert [item["id"] for item in listed] == [second["id"], first["id"]]

        updated = await client.patch(
            f"/v1/visual-workshop/projects/{first['id']}",
            json={
                "expected_revision": first["revision"],
                "title": "产品主视觉 v2",
                "status": "completed",
            },
        )
        assert updated.status_code == 200
        current = updated.json()
        assert current["revision"] == 1
        assert current["status"] == "completed"
        assert (await client.get("/v1/visual-workshop/projects")).json()["items"][0]["id"] == first[
            "id"
        ]

        stale = await client.patch(
            f"/v1/visual-workshop/projects/{first['id']}",
            json={"expected_revision": 0, "status": "draft"},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"
        assert stale.json()["current"] == current

        assert (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "   ", "kind": "image"},
            )
        ).status_code == 422
        assert (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "错误类型", "kind": "audio"},
            )
        ).status_code == 422
        assert (
            await client.patch(
                f"/v1/visual-workshop/projects/{first['id']}",
                json={"expected_revision": 1},
            )
        ).status_code == 422
        assert (await client.get("/v1/visual-workshop/projects/missing")).status_code == 404

        deleted = await client.delete(
            f"/v1/visual-workshop/projects/{first['id']}",
            params={"expected_revision": current["revision"]},
        )
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}
        assert (
            await client.delete(
                f"/v1/visual-workshop/projects/{second['id']}",
                params={"expected_revision": second["revision"]},
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_visual_workshop_routes_use_studio_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = "v" * 32
    monkeypatch.setattr(
        deps,
        "get_settings",
        lambda: SimpleNamespace(fpl_studio_token=token),
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/v1/visual-workshop/projects")).status_code == 401
        authorized = await client.get(
            "/v1/visual-workshop/projects",
            headers={"X-Studio-Token": token},
        )
        assert authorized.status_code == 200


@pytest.mark.asyncio
async def test_file_management_upload_folders_and_project_references() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(VisualProjectAssetReference))
        await session.execute(delete(VisualAsset))
        await session.execute(delete(VisualAssetFolder))
        await session.execute(delete(VisualWorkshopProject))
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "素材项目", "kind": "canvas"},
            )
        ).json()
        library_folder = await client.post(
            "/v1/file-folders",
            json={"scope": "library", "name": "品牌素材"},
        )
        assert library_folder.status_code == 200, library_folder.text
        project_folder = await client.post(
            "/v1/file-folders",
            json={"scope": "project", "project_id": project["id"], "name": "场景"},
        )
        assert project_folder.status_code == 200

        image = await client.post(
            "/v1/files",
            data={"folder_id": library_folder.json()["id"]},
            files={
                "upload": (
                    "hero.png",
                    b"\x89PNG\r\n\x1a\n" + b"safe-image-content",
                    "image/png",
                )
            },
        )
        assert image.status_code == 200, image.text
        asset = image.json()
        assert asset["media_kind"] == "image"
        assert asset["source"] == "library"

        project_upload = await client.post(
            "/v1/files",
            data={"project_id": project["id"], "folder_id": project_folder.json()["id"]},
            files={"upload": ("notes.md", b"# shooting notes", "text/markdown")},
        )
        assert project_upload.status_code == 200, project_upload.text
        assert project_upload.json()["source"] == "project"

        first_reference = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/asset-references",
            json={"asset_id": asset["id"]},
        )
        second_reference = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/asset-references",
            json={"asset_id": asset["id"]},
        )
        assert first_reference.status_code == 200
        assert second_reference.json()["reference_id"] == first_reference.json()["reference_id"]

        canvas = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {
                        "id": "image-1",
                        "kind": "image",
                        "title": "参考图",
                        "position": {"x": 20, "y": 30},
                        "asset_id": asset["id"],
                    }
                ],
            },
        )
        assert canvas.status_code == 200, canvas.text

        project_root = await client.get("/v1/files", params={"project_id": project["id"]})
        assert project_root.status_code == 200
        assert project_root.json()["items"][0]["is_reference"] is True

        blocked = await client.delete(
            f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
        )
        assert blocked.status_code == 409
        assert blocked.json()["code"] == "asset_in_use"

        reference = first_reference.json()
        removed = await client.delete(
            f"/v1/visual-workshop/projects/{project['id']}/asset-references/"
            f"{reference['reference_id']}",
            params={"expected_revision": reference["revision"]},
        )
        assert removed.status_code == 200
        deleted = await client.delete(
            f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
        )
        assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_file_management_rejects_invalid_content_and_scope() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        invalid = await client.post(
            "/v1/files",
            files={"upload": ("fake.png", b"not-a-png", "image/png")},
        )
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "invalid_file_content"
        unsupported = await client.post(
            "/v1/files",
            files={"upload": ("archive.zip", b"PK contents", "application/zip")},
        )
        assert unsupported.status_code == 422
        assert unsupported.json()["code"] == "unsupported_file_type"


@pytest.mark.asyncio
async def test_visual_generation_options_creation_filters_and_active_provider_guard() -> None:
    provider = ModelProvider(
        id=str(uuid4()),
        name="SenseAudio 图片测试通道",
        kind="senseaudio_image",
        base_url="https://api.senseaudio.cn/v1",
        api_key_ciphertext="",
        enabled=True,
        sort_order=90,
    )
    model = ModelEntry(
        id=str(uuid4()),
        provider_id=provider.id,
        slug="senseaudio-image-2.0-260319",
        label="SenseAudio Image 2.0 Test",
        description="确定性测试模型",
        capabilities=["image_generation"],
        enabled=True,
        sort_order=0,
    )
    async with SessionLocal() as session:
        session.add(provider)
        await session.commit()
    async with SessionLocal() as session:
        session.add(model)
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "AI 主视觉", "kind": "image"},
            )
        ).json()
        options = await client.get("/v1/visual-workshop/generation-options")
        assert options.status_code == 200
        option = next(item for item in options.json()["models"] if item["id"] == model.id)
        assert option["kind"] == "image"
        assert "1024x1024" in option["sizes"]

        missing_key = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "image",
                "model_id": model.id,
                "prompt": "未来城市的电影海报",
                "size": "1024x1024",
            },
        )
        assert missing_key.status_code == 409
        assert missing_key.json()["code"] == "missing_api_key"

        async with SessionLocal() as session:
            stored_provider = await session.get(ModelProvider, provider.id)
            assert stored_provider is not None
            stored_provider.api_key_ciphertext = encrypt_secret("test-only-secret")
            await session.commit()

        invalid_size = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "image",
                "model_id": model.id,
                "prompt": "未来城市",
                "size": "1x1",
            },
        )
        assert invalid_size.status_code == 422
        assert invalid_size.json()["code"] == "unsupported_size"

        created = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "image",
                "model_id": model.id,
                "prompt": "未来城市的电影海报",
                "size": "1024x1024",
                "seed": 9,
            },
        )
        assert created.status_code == 200, created.text
        task = created.json()
        assert task["status"] == "queued"
        assert task["request_payload"]["seed"] == 9
        assert "test-only-secret" not in created.text
        assert "data:" not in created.text

        listed = await client.get(
            "/v1/visual-workshop/generation-tasks",
            params={"project_id": project["id"], "kind": "image", "status": "queued"},
        )
        assert listed.status_code == 200
        assert listed.json()["total"] == 1
        assert listed.json()["items"][0]["id"] == task["id"]

        catalog = (await client.get("/v1/model-providers")).json()
        blocked = await client.post(
            f"/v1/model-providers/{provider.id}/enabled",
            json={"enabled": False, "expected_catalog_revision": catalog["revision"]},
        )
        assert blocked.status_code == 409
        assert blocked.json()["code"] == "resource_busy"

        paid_test = await client.post(f"/v1/model-entries/{model.id}/test")
        assert paid_test.status_code == 409

        invalid_video_mode = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "video",
                "model_id": model.id,
                "prompt": "跟随音乐",
                "mode": "reference",
                "audio_urls": ["https://media.example/music.mp3"],
            },
        )
        assert invalid_video_mode.status_code == 422
        private_video_url = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "video",
                "model_id": model.id,
                "mode": "reference",
                "video_urls": ["https://127.0.0.1/reference.mp4"],
            },
        )
        assert private_video_url.status_code == 422

    async with SessionLocal() as session:
        await session.execute(
            delete(VisualGenerationTask).where(VisualGenerationTask.provider_id == provider.id)
        )
        project_row = await session.get(VisualWorkshopProject, project["id"])
        if project_row:
            await session.delete(project_row)
        stored_provider = await session.get(ModelProvider, provider.id)
        if stored_provider:
            await session.delete(stored_provider)
        await session.commit()
