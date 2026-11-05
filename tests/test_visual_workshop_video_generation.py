from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.capabilities.asset_store.models import (
    VisualAsset,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.llm.models import ModelEntry, ModelProvider
from app.main import app
from app.runtime.config import get_settings
from app.runtime.credentials import encrypt_secret
from app.runtime.db import SessionLocal
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import VisualGenerationTask, VisualWorkshopProject


@pytest.mark.asyncio
async def test_visual_video_generation_uses_scoped_media_asset_ids() -> None:
    provider = ModelProvider(
        owner_user_id="test-user",
        id=str(uuid4()),
        name="SenseAudio 视频素材测试通道",
        kind="senseaudio_video",
        base_url="https://api.senseaudio.cn/v1",
        api_key_ciphertext=encrypt_secret("test-only-secret"),
        enabled=True,
        sort_order=91,
    )
    model = ModelEntry(
        owner_user_id="test-user",
        id=str(uuid4()),
        provider_id=provider.id,
        slug="doubao-seedance-2-0-260128",
        label="SenseAudio Video Reference Test",
        description="确定性测试模型",
        capabilities=["video_generation"],
        enabled=True,
        sort_order=0,
    )
    async with SessionLocal() as session:
        session.add(provider)
        await session.commit()
    async with SessionLocal() as session:
        session.add(model)
        await session.commit()

    assets: list[dict] = []
    project_ids: list[str] = []
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            for title in ("视频素材项目", "其他项目"):
                response = await client.post(
                    "/v1/visual-workshop/projects",
                    json={"title": title, "kind": "video"},
                )
                assert response.status_code == 200, response.text
                project_ids.append(response.json()["id"])

            async def upload(project_id: str, filename: str, content: bytes, mime: str) -> dict:
                response = await client.post(
                    "/v1/files",
                    data={"project_id": project_id},
                    files={"upload": (filename, content, mime)},
                )
                assert response.status_code == 200, response.text
                return response.json()

            image = await upload(
                project_ids[0],
                "reference.png",
                b"\x89PNG\r\n\x1a\nreference",
                "image/png",
            )
            manual_image = await upload(
                project_ids[0],
                "manual.png",
                b"\x89PNG\r\n\x1a\nmanual",
                "image/png",
            )
            inherited_image = await upload(
                project_ids[0],
                "inherited.png",
                b"\x89PNG\r\n\x1a\ninherited",
                "image/png",
            )
            audio = await upload(project_ids[0], "reference.mp3", b"ID3reference", "audio/mpeg")
            video = await upload(
                project_ids[0],
                "reference.mp4",
                b"\x00\x00\x00\x18ftypisomreference",
                "video/mp4",
            )
            other_video = await upload(
                project_ids[1],
                "other.mp4",
                b"\x00\x00\x00\x18ftypisomother",
                "video/mp4",
            )

            created = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/generation-tasks",
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "prompt": "跟随参考素材",
                    "mode": "reference",
                    "reference_asset_ids": [image["id"]],
                    "audio_asset_ids": [audio["id"]],
                    "video_asset_ids": [video["id"]],
                },
            )
            assert created.status_code == 200, created.text
            assert created.json()["canvas_node_id"] is None
            payload = created.json()["request_payload"]
            assert payload["reference_asset_ids"] == [image["id"]]
            assert payload["audio_asset_ids"] == [audio["id"]]
            assert payload["video_asset_ids"] == [video["id"]]
            assert "temp.sh" not in created.text
            assert "data:" not in created.text

            canvas_nodes = [
                {
                    "id": "source-image",
                    "kind": "image",
                    "title": "直连图片",
                    "position": {"x": 0, "y": 0},
                    "asset_id": image["id"],
                    "generation_draft": {
                        "model_id": None,
                        "prompt": "不应递归继承的草稿",
                        "size": "1024x1024",
                        "seed": None,
                        "image_count": 1,
                        "reference_asset_id": inherited_image["id"],
                    },
                },
                {
                    "id": "source-video",
                    "kind": "video",
                    "title": "直连视频",
                    "position": {"x": 0, "y": 300},
                    "asset_id": video["id"],
                },
                {
                    "id": "source-audio",
                    "kind": "audio",
                    "title": "直连音频",
                    "position": {"x": 0, "y": 600},
                    "asset_id": audio["id"],
                },
                {
                    "id": "target-video",
                    "kind": "video",
                    "title": "目标视频",
                    "position": {"x": 500, "y": 200},
                    "asset_id": None,
                },
            ]
            canvas_edges = [
                {
                    "id": f"edge-{kind}",
                    "source_node_id": f"source-{kind}",
                    "target_node_id": "target-video",
                }
                for kind in ("image", "video", "audio")
            ]
            saved_canvas = await client.put(
                f"/v1/visual-workshop/projects/{project_ids[0]}/canvas",
                json={
                    "expected_revision": 0,
                    "nodes": canvas_nodes,
                    "edges": canvas_edges,
                },
            )
            assert saved_canvas.status_code == 200, saved_canvas.text
            linked_generation = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/generation-tasks",
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "prompt": "只使用直连节点主素材",
                    "mode": "reference",
                    "reference_asset_ids": [manual_image["id"], image["id"]],
                    "video_asset_ids": [],
                    "audio_asset_ids": [],
                    "canvas_node_id": "target-video",
                    "expected_canvas_revision": 1,
                },
            )
            assert linked_generation.status_code == 200, linked_generation.text
            linked_payload = linked_generation.json()["request_payload"]
            assert linked_payload["mode"] == "reference"
            assert linked_payload["reference_asset_ids"] == [
                manual_image["id"],
                image["id"],
            ]
            assert inherited_image["id"] not in linked_payload["reference_asset_ids"]
            assert linked_payload["video_asset_ids"] == [video["id"]]
            assert linked_payload["audio_asset_ids"] == [audio["id"]]
            assert linked_payload["reference_filenames"] == {
                image["id"]: "直连图片.png",
                video["id"]: "直连视频.mp4",
                audio["id"]: "直连音频.mp3",
            }

            pending_nodes = [
                *canvas_nodes,
                {
                    "id": "source-pending",
                    "kind": "image",
                    "title": "等待素材",
                    "position": {"x": 0, "y": 900},
                    "asset_id": None,
                },
            ]
            pending_canvas = await client.put(
                f"/v1/visual-workshop/projects/{project_ids[0]}/canvas",
                json={
                    "expected_revision": 2,
                    "nodes": pending_nodes,
                    "edges": [
                        *canvas_edges,
                        {
                            "id": "edge-pending",
                            "source_node_id": "source-pending",
                            "target_node_id": "target-video",
                        },
                    ],
                },
            )
            assert pending_canvas.status_code == 200, pending_canvas.text
            pending_generation = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/generation-tasks",
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "prompt": "等待上游素材",
                    "mode": "reference",
                    "reference_asset_ids": [manual_image["id"]],
                    "canvas_node_id": "target-video",
                    "expected_canvas_revision": 3,
                },
            )
            assert pending_generation.status_code == 409
            assert pending_generation.json()["code"] == "upstream_asset_pending"

            scope_mismatch = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/generation-tasks",
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "mode": "reference",
                    "video_asset_ids": [other_video["id"]],
                },
            )
            assert scope_mismatch.status_code == 422
            assert scope_mismatch.json()["code"] == "scope_mismatch"

            imported = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/asset-imports",
                json={
                    "source_scope": "project",
                    "source_project_id": project_ids[1],
                    "asset_ids": [other_video["id"]],
                },
            )
            assert imported.status_code == 200, imported.text
            imported_video_id = imported.json()["items"][0]["id"]
            imported_generation = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/generation-tasks",
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "mode": "reference",
                    "video_asset_ids": [imported_video_id],
                },
            )
            assert imported_generation.status_code == 200, imported_generation.text

            wrong_type = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/generation-tasks",
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "mode": "reference",
                    "video_asset_ids": [audio["id"]],
                },
            )
            assert wrong_type.status_code == 422
            assert wrong_type.json()["code"] == "invalid_reference"
    finally:
        async with SessionLocal() as session:
            assets = list(
                (
                    await session.execute(
                        VisualAsset.__table__.select().where(
                            VisualAsset.project_id.in_(project_ids)
                        )
                    )
                )
                .mappings()
                .all()
            )
            await session.execute(
                delete(VisualGenerationTask).where(VisualGenerationTask.provider_id == provider.id)
            )
            if project_ids:
                await session.execute(delete(VisualNodeOutput))
                await session.execute(
                    delete(VisualAsset).where(VisualAsset.project_id.in_(project_ids))
                )
                await session.execute(
                    delete(VisualWorkshopProject).where(VisualWorkshopProject.id.in_(project_ids))
                )
            await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
            await session.commit()
        storage = AssetStorage(get_settings())
        for asset in assets:
            path = storage.target_path(
                str(asset["storage_key"]),
                visual_project_id=str(asset["project_id"]),
                galgame_project_id=None,
                owner_user_id=str(asset["owner_user_id"]),
            )
            path.unlink(missing_ok=True)
