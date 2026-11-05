from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

import app.capabilities.asset_store.assets as asset_module
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualAssetFolder,
    VisualProjectAssetReference,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.llm.models import (
    ModelEntry,
    ModelProvider,
)
from app.runtime.credentials import encrypt_secret
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import (
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.config.settings import get_settings
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
async def test_visual_workshop_project_crud_validation_sorting_and_conflicts() -> None:
    from tests.account_fixtures import clear_private_projects

    await clear_private_projects()
    async with SessionLocal() as session:
        await session.execute(
            delete(VisualWorkshopProject).where(VisualWorkshopProject.owner_user_id == "test-user")
        )
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
@pytest.mark.real_auth
async def test_visual_workshop_routes_use_studio_auth() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/v1/visual-workshop/projects")).status_code == 401


@pytest.mark.asyncio
async def test_file_management_upload_folders_and_project_references() -> None:
    from tests.account_fixtures import clear_private_projects

    await clear_private_projects()
    async with SessionLocal() as session:
        await session.execute(delete(VisualProjectAssetReference))
        await session.execute(
            delete(ThoughtKnowledgeBase).where(ThoughtKnowledgeBase.owner_user_id == "test-user")
        )
        await session.execute(delete(ThoughtNote))
        await session.execute(delete(VisualNodeOutput))
        await session.execute(delete(VisualAsset).where(VisualAsset.owner_user_id == "test-user"))
        await session.execute(delete(VisualAssetFolder))
        await session.execute(
            delete(VisualWorkshopProject).where(VisualWorkshopProject.owner_user_id == "test-user")
        )
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
        assert asset["original_filename"] == "hero.png"
        assert asset["display_name"] == "hero"

        project_upload = await client.post(
            "/v1/files",
            data={"project_id": project["id"], "folder_id": project_folder.json()["id"]},
            files={"upload": ("notes.md", b"# shooting notes", "text/markdown")},
        )
        assert project_upload.status_code == 200, project_upload.text
        assert project_upload.json()["source"] == "project"
        assert project_upload.json()["display_name"] == "notes"

        aliased_download = await client.get(
            f"/v1/files/{project_upload.json()['id']}/download",
            params={"download_name": "分镜/脚本.exe"},
        )
        assert aliased_download.status_code == 200
        disposition = aliased_download.headers["content-disposition"]
        assert "%E5%88%86%E9%95%9C-%E8%84%9A%E6%9C%AC.exe.md" in disposition

        transcript_upload = await client.post(
            "/v1/files",
            files={
                "upload": (
                    "radio-drama-transcript.json",
                    b'{"text":"' + (b"a" * 502) + "你".encode() + b'"}',
                    "application/json",
                )
            },
        )
        assert transcript_upload.status_code == 200, transcript_upload.text
        assert transcript_upload.json()["media_kind"] == "document"
        assert transcript_upload.json()["mime_type"] == "application/json"
        assert transcript_upload.json()["source"] == "library"
        assert transcript_upload.json()["display_name"] == "radio-drama-transcript"

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
        assert deleted.status_code == 409
        # Output history owns its media after a project-library reference is removed.
        cleared = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={"expected_revision": canvas.json()["revision"], "nodes": [], "edges": []},
        )
        assert cleared.status_code == 200, cleared.text
        deleted = await client.delete(
            f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
        )
        assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_visual_workshop_imports_library_references_and_project_copies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        target = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "素材接收项目", "kind": "canvas"},
            )
        ).json()
        source = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "素材来源项目", "kind": "canvas"},
            )
        ).json()

        library = (
            await client.post(
                "/v1/files",
                files={
                    "upload": (
                        "library.png",
                        b"\x89PNG\r\n\x1a\nlibrary-image",
                        "image/png",
                    )
                },
            )
        ).json()

        async def upload_source(name: str, payload: bytes) -> dict:
            response = await client.post(
                "/v1/files",
                data={"project_id": source["id"]},
                files={"upload": (name, b"\x89PNG\r\n\x1a\n" + payload, "image/png")},
            )
            assert response.status_code == 200, response.text
            return response.json()

        first = await upload_source("first.png", b"first-project-image")
        second = await upload_source("second.png", b"second-project-image")

        library_import = await client.post(
            f"/v1/visual-workshop/projects/{target['id']}/asset-imports",
            json={"source_scope": "library", "asset_ids": [library["id"]]},
        )
        repeated_library_import = await client.post(
            f"/v1/visual-workshop/projects/{target['id']}/asset-imports",
            json={"source_scope": "library", "asset_ids": [library["id"]]},
        )
        assert library_import.status_code == 200, library_import.text
        assert (
            repeated_library_import.json()["items"][0]["reference_id"]
            == library_import.json()["items"][0]["reference_id"]
        )

        copied = await client.post(
            f"/v1/visual-workshop/projects/{target['id']}/asset-imports",
            json={
                "source_scope": "project",
                "source_project_id": source["id"],
                "asset_ids": [second["id"], first["id"]],
            },
        )
        assert copied.status_code == 200, copied.text
        imported = copied.json()["items"]
        assert [item["display_name"] for item in imported] == ["second", "first"]
        assert all(item["project_id"] == target["id"] for item in imported)
        assert all(item["id"] not in {first["id"], second["id"]} for item in imported)

        duplicate_ids = await client.post(
            f"/v1/visual-workshop/projects/{target['id']}/asset-imports",
            json={
                "source_scope": "project",
                "source_project_id": source["id"],
                "asset_ids": [first["id"], first["id"]],
            },
        )
        assert duplicate_ids.status_code == 422
        same_project = await client.post(
            f"/v1/visual-workshop/projects/{target['id']}/asset-imports",
            json={
                "source_scope": "project",
                "source_project_id": target["id"],
                "asset_ids": [imported[0]["id"]],
            },
        )
        assert same_project.status_code == 422
        assert same_project.json()["code"] == "scope_mismatch"

        root = (
            AssetStorage(get_settings()).project_root(
                "visual-workshop", target["id"], owner_user_id="test-user"
            )
            / "assets"
        )
        files_before_failure = {path.name for path in root.iterdir() if path.is_file()}
        target_before_failure = (
            await client.get("/v1/files", params={"project_id": target["id"]})
        ).json()["items"]
        real_copyfile = asset_module.shutil.copyfile
        copy_attempts = 0

        def fail_second_copy(source_path, target_path):
            nonlocal copy_attempts
            copy_attempts += 1
            if copy_attempts == 2:
                raise OSError("deterministic copy failure")
            return real_copyfile(source_path, target_path)

        monkeypatch.setattr(asset_module.shutil, "copyfile", fail_second_copy)
        failed_copy = await client.post(
            f"/v1/visual-workshop/projects/{target['id']}/asset-imports",
            json={
                "source_scope": "project",
                "source_project_id": source["id"],
                "asset_ids": [first["id"], second["id"]],
            },
        )
        assert failed_copy.status_code == 500
        assert failed_copy.json()["code"] == "asset_import_failed"
        target_after_failure = (
            await client.get("/v1/files", params={"project_id": target["id"]})
        ).json()["items"]
        assert len(target_after_failure) == len(target_before_failure)
        assert {path.name for path in root.iterdir() if path.is_file()} == files_before_failure

        deleted_source = await client.delete(
            f"/v1/visual-workshop/projects/{source['id']}",
            params={"expected_revision": source["revision"]},
        )
        assert deleted_source.status_code == 200
        copied_content = await client.get(f"/v1/files/{imported[0]['id']}/content")
        assert copied_content.status_code == 200
        assert copied_content.content.endswith(b"second-project-image")


@pytest.mark.asyncio
async def test_file_library_imports_project_copies_with_display_names() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        source = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "公共库复制源", "kind": "canvas"},
            )
        ).json()
        uploaded = await client.post(
            "/v1/files",
            data={"project_id": source["id"], "display_name": "原始海报"},
            files={
                "upload": (
                    "poster.png",
                    b"\x89PNG\r\n\x1a\nproject-to-library",
                    "image/png",
                )
            },
        )
        assert uploaded.status_code == 200, uploaded.text
        assert uploaded.json()["display_name"] == "原始海报"

        folder = await client.post(
            "/v1/file-folders",
            json={"scope": "library", "name": "从项目收集"},
        )
        assert folder.status_code == 200, folder.text

        imported = await client.post(
            "/v1/file-library/asset-imports",
            json={
                "source_project_id": source["id"],
                "asset_ids": [uploaded.json()["id"]],
                "folder_id": folder.json()["id"],
                "display_names": {uploaded.json()["id"]: "库内海报"},
            },
        )
        assert imported.status_code == 200, imported.text
        item = imported.json()["items"][0]
        assert item["project_id"] is None
        assert item["folder_id"] == folder.json()["id"]
        assert item["display_name"] == "库内海报"
        assert item["id"] != uploaded.json()["id"]
        content = await client.get(f"/v1/files/{item['id']}/content")
        assert content.status_code == 200
        assert content.content.endswith(b"project-to-library")

        wrong_scope = await client.post(
            "/v1/file-library/asset-imports",
            json={
                "source_project_id": source["id"],
                "asset_ids": [item["id"]],
            },
        )
        assert wrong_scope.status_code == 422
        assert wrong_scope.json()["code"] == "scope_mismatch"


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
        invalid_json = await client.post(
            "/v1/files",
            files={"upload": ("broken.json", b'{"segments":', "application/json")},
        )
        assert invalid_json.status_code == 422
        assert invalid_json.json()["code"] == "invalid_file_content"
        unsupported = await client.post(
            "/v1/files",
            files={"upload": ("unsupported.exe", b"executable", "application/octet-stream")},
        )
        assert unsupported.status_code == 422
        assert unsupported.json()["code"] == "unsupported_file_type"


@pytest.mark.asyncio
async def test_file_upload_accepts_mkv_despite_browser_mime_mislabels() -> None:
    """Browsers often declare Matroska as video/mp4 or video/webm; magic bytes win."""
    transport = httpx.ASGITransport(app=app)
    matroska_head = b"\x1aE\xdf\xa3" + b"matroska-test-payload"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for declared in (
            "video/mp4",
            "video/webm",
            "video/x-matroska; charset=binary",
            "application/x-matroska",
        ):
            response = await client.post(
                "/v1/files",
                files={"upload": ("clip.mkv", matroska_head, declared)},
            )
            assert response.status_code == 200, f"{declared}: {response.text}"
            body = response.json()
            assert body["original_filename"] == "clip.mkv"
            assert body["media_kind"] == "video"
            assert body["mime_type"] in {
                "video/x-matroska",
                "video/matroska",
                "application/x-matroska",
                "application/octet-stream",
            }


@pytest.mark.asyncio
async def test_canvas_generation_drafts_round_trip_validate_and_tolerate_stale_assets() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "节点生成草稿", "kind": "canvas"},
            )
        ).json()

        async def upload(name: str, content: bytes, mime_type: str) -> dict:
            response = await client.post(
                "/v1/files",
                data={"project_id": project["id"]},
                files={"upload": (name, content, mime_type)},
            )
            assert response.status_code == 200, response.text
            return response.json()

        image = await upload(
            "draft.png",
            b"\x89PNG\r\n\x1a\n" + b"draft-image",
            "image/png",
        )
        video = await upload(
            "draft.mp4",
            b"\x00\x00\x00\x18ftypisom" + b"draft-video",
            "video/mp4",
        )
        audio = await upload("draft.mp3", b"ID3draft-audio", "audio/mpeg")
        nodes = [
            {
                "id": "image-1",
                "kind": "image",
                "title": "图片1",
                "position": {"x": 20, "y": 30},
                "generation_draft": {
                    "model_id": "image-model",
                    "prompt": "电影感主视觉",
                    "size": "1536x864",
                    "seed": 42,
                    "image_count": 3,
                    "reference_asset_id": image["id"],
                    "prompt_reference_names": {image["id"]: "分镜图1.png"},
                },
            },
            {
                "id": "video-1",
                "kind": "video",
                "title": "视频1",
                "position": {"x": 220, "y": 30},
                "generation_draft": {
                    "model_id": "video-model",
                    "prompt": "镜头缓慢推进",
                    "mode": "reference",
                    "duration": 8,
                    "resolution": "1080p",
                    "ratio": "9:16",
                    "watermark": False,
                    "generate_audio": True,
                    "first_frame_asset_id": image["id"],
                    "last_frame_asset_id": None,
                    "reference_asset_ids": [image["id"]],
                    "audio_asset_ids": [audio["id"]],
                    "video_asset_ids": [video["id"]],
                    "prompt_reference_names": {
                        image["id"]: "分镜图1.png",
                        video["id"]: "开局.mp4",
                    },
                },
            },
        ]
        saved = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={"expected_revision": 0, "nodes": nodes},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["nodes"][0]["generation_draft"]["image_count"] == 3
        assert saved.json()["nodes"][1]["generation_draft"] == {
            **nodes[1]["generation_draft"],
            "prompt_versions": [{"id": "v1", "name": "v1", "prompt": "镜头缓慢推进"}],
            "active_prompt_version_id": "v1",
            "workflow_parameters": None,
        }

        structured_nodes = saved.json()["nodes"]
        duplicate = [dict(node) for node in structured_nodes]
        duplicate[1] = {
            **duplicate[1],
            "generation_draft": {
                **duplicate[1]["generation_draft"],
                "video_asset_ids": [video["id"], video["id"]],
            },
        }
        assert (
            await client.put(
                f"/v1/visual-workshop/projects/{project['id']}/canvas",
                json={"expected_revision": 1, "nodes": duplicate},
            )
        ).status_code == 422

        wrong_kind = [dict(node) for node in structured_nodes]
        wrong_kind[1] = {
            **wrong_kind[1],
            "generation_draft": {
                **wrong_kind[1]["generation_draft"],
                "reference_asset_ids": [audio["id"]],
            },
        }
        wrong_kind_response = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={"expected_revision": 1, "nodes": wrong_kind},
        )
        assert wrong_kind_response.status_code == 422
        assert wrong_kind_response.json()["code"] == "asset_kind_mismatch"

        invalid_range = [dict(node) for node in structured_nodes]
        invalid_range[1] = {
            **invalid_range[1],
            "generation_draft": {
                **invalid_range[1]["generation_draft"],
                "duration": 31,
            },
        }
        assert (
            await client.put(
                f"/v1/visual-workshop/projects/{project['id']}/canvas",
                json={"expected_revision": 1, "nodes": invalid_range},
            )
        ).status_code == 422

        other_project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "其他项目", "kind": "canvas"},
            )
        ).json()
        foreign_image_response = await client.post(
            "/v1/files",
            data={"project_id": other_project["id"]},
            files={
                "upload": (
                    "foreign.png",
                    b"\x89PNG\r\n\x1a\n" + b"foreign-image",
                    "image/png",
                )
            },
        )
        assert foreign_image_response.status_code == 200
        wrong_scope = [dict(node) for node in structured_nodes]
        wrong_scope[0] = {
            **wrong_scope[0],
            "generation_draft": {
                **wrong_scope[0]["generation_draft"],
                "reference_asset_id": foreign_image_response.json()["id"],
            },
        }
        wrong_scope_response = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={"expected_revision": 1, "nodes": wrong_scope},
        )
        assert wrong_scope_response.status_code == 422
        assert wrong_scope_response.json()["code"] == "scope_mismatch"

        assert (
            await client.delete(
                f"/v1/files/{image['id']}",
                params={"expected_revision": image["revision"]},
            )
        ).status_code == 200
        stale_nodes = [dict(node) for node in structured_nodes]
        stale_nodes[1] = {
            **stale_nodes[1],
            "generation_draft": {
                **stale_nodes[1]["generation_draft"],
                "prompt": "删除参考图后仍可保存其他修改",
            },
        }
        # Simulate a legacy client updating only the single prompt field.
        stale_nodes[1]["generation_draft"].pop("prompt_versions", None)
        stale_nodes[1]["generation_draft"].pop("active_prompt_version_id", None)
        stale_saved = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={"expected_revision": 1, "nodes": stale_nodes},
        )
        assert stale_saved.status_code == 200, stale_saved.text
        assert (
            stale_saved.json()["nodes"][1]["generation_draft"]["prompt"]
            == "删除参考图后仍可保存其他修改"
        )


@pytest.mark.asyncio
async def test_visual_generation_options_creation_filters_and_active_provider_guard() -> None:
    provider = ModelProvider(
        owner_user_id="test-user",
        id=str(uuid4()),
        name="SenseAudio 图片测试通道",
        kind="senseaudio_image",
        base_url="https://api.senseaudio.cn/v1",
        api_key_ciphertext="",
        enabled=True,
        sort_order=90,
    )
    model = ModelEntry(
        owner_user_id="test-user",
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

        canvas_node = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {
                        "id": "image-node-1",
                        "kind": "image",
                        "title": "图片节点",
                        "position": {"x": 120, "y": 80},
                        "asset_id": None,
                    }
                ],
            },
        )
        assert canvas_node.status_code == 200, canvas_node.text
        assert canvas_node.json()["revision"] == 1

        created = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "image",
                "model_id": model.id,
                "prompt": "未来城市的电影海报",
                "size": "1024x1024",
                "seed": 9,
                "canvas_node_id": "image-node-1",
                "expected_canvas_revision": 1,
            },
        )
        assert created.status_code == 200, created.text
        task = created.json()
        assert task["status"] == "queued"
        assert task["canvas_node_id"] == "image-node-1"
        assert task["request_payload"]["seed"] == 9
        assert "canvas_node_id" not in task["request_payload"]
        linked_canvas = (
            await client.get(f"/v1/visual-workshop/projects/{project['id']}/canvas")
        ).json()
        assert linked_canvas["revision"] == 2
        assert linked_canvas["nodes"][0]["generation_task_id"] == task["id"]
        assert linked_canvas["nodes"][0]["asset_id"] is None
        assert "test-only-secret" not in created.text
        assert "data:" not in created.text

        listed = await client.get(
            "/v1/visual-workshop/generation-tasks",
            params={
                "project_id": project["id"],
                "canvas_node_id": "image-node-1",
                "kind": "image",
                "status": "queued",
            },
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

        blocked_model = await client.patch(
            f"/v1/model-entries/{model.id}",
            json={
                "slug": model.slug,
                "capabilities": model.capabilities,
                "enabled": False,
                "expected_catalog_revision": catalog["revision"],
            },
        )
        assert blocked_model.status_code == 409, blocked_model.text
        assert blocked_model.json()["code"] == "resource_busy"
        blocked_delete = await client.delete(
            f"/v1/model-entries/{model.id}",
            params={"expected_catalog_revision": catalog["revision"]},
        )
        assert blocked_delete.status_code == 409, blocked_delete.text
        assert blocked_delete.json()["code"] == "resource_busy"

        paid_test = await client.post(f"/v1/model-entries/{model.id}/test")
        assert paid_test.status_code == 409

        invalid_video_mode = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "video",
                "model_id": model.id,
                "prompt": "跟随音乐",
                "mode": "reference",
                "audio_asset_ids": ["audio-only"],
            },
        )
        assert invalid_video_mode.status_code == 409
        assert invalid_video_mode.json()["code"] == "model_unavailable"
        duplicate_reference = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/generation-tasks",
            json={
                "kind": "video",
                "model_id": model.id,
                "mode": "reference",
                "reference_asset_ids": ["duplicate"],
                "video_asset_ids": ["duplicate"],
            },
        )
        assert duplicate_reference.status_code == 422

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
