from __future__ import annotations

import io

import httpx
import pytest
from PIL import Image
from sqlalchemy import delete

from app.apps.video_editor.models import VideoEditorProject
from app.apps.video_editor.runner import VideoEditorRunner
from app.main import app
from app.runtime.db import SessionLocal


async def _reset() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        await session.commit()


@pytest.mark.asyncio
async def test_video_editor_asset_default_effects_cas_and_bake_image() -> None:
    await _reset()
    image = io.BytesIO()
    # Green background with a red subject pixel for chroma bake.
    canvas = Image.new("RGB", (32, 32), "#00ff00")
    canvas.putpixel((16, 16), (220, 40, 30))
    canvas.save(image, format="PNG")
    payload = image.getvalue()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "默认效果"})
        ).json()
        upload = await client.post(
            f"/v1/video-editor/projects/{project['id']}/assets",
            files={"upload": ("plate.png", payload, "image/png")},
        )
        assert upload.status_code == 200
        asset = upload.json()
        assert asset["revision"] == 0
        assert asset["defaultEffects"] == {"chromaKey": None}

        await VideoEditorRunner(lane="media").process_once()
        listed = (await client.get(f"/v1/video-editor/projects/{project['id']}/assets")).json()
        asset = next(item for item in listed["items"] if item["id"] == asset["id"])
        assert asset["processingStatus"] == "ready"

        chroma = {
            "enabled": True,
            "color": "#00ff00",
            "similarity": 42,
            "softness": 18,
            "despill": 30,
        }
        patched = await client.patch(
            f"/v1/video-editor/projects/{project['id']}/assets/{asset['id']}",
            json={"expectedRevision": asset["revision"], "defaultEffects": {"chromaKey": chroma}},
        )
        assert patched.status_code == 200
        assert patched.json()["revision"] == asset["revision"] + 1
        assert patched.json()["defaultEffects"]["chromaKey"]["enabled"] is True

        conflict = await client.patch(
            f"/v1/video-editor/projects/{project['id']}/assets/{asset['id']}",
            json={"expectedRevision": asset["revision"], "defaultEffects": {"chromaKey": None}},
        )
        assert conflict.status_code == 409

        bake = await client.post(
            f"/v1/video-editor/projects/{project['id']}/assets/{asset['id']}/bakes",
            json={
                "expectedRevision": patched.json()["revision"],
                "requestId": "bake-plate-1",
            },
        )
        assert bake.status_code == 200
        assert bake.json()["kind"] == "asset_bake"
        task_id = bake.json()["id"]
        await VideoEditorRunner().process_once()
        task = (
            await client.get(f"/v1/video-editor/projects/{project['id']}/asset-bakes/{task_id}")
        ).json()
        assert task["status"] == "completed"
        assert task["outputAssetId"]
        assert task["outputAssetId"] != asset["id"]

        assets = (await client.get(f"/v1/video-editor/projects/{project['id']}/assets")).json()[
            "items"
        ]
        output = next(item for item in assets if item["id"] == task["outputAssetId"])
        source = next(item for item in assets if item["id"] == asset["id"])
        assert output["mediaKind"] == "image"
        assert output["defaultEffects"] == {"chromaKey": None}
        assert source["defaultEffects"]["chromaKey"]["enabled"] is True
        timeline = (await client.get(f"/v1/video-editor/projects/{project['id']}/timeline")).json()
        root_ids = timeline["document"]["assetOrganization"]["rootAssetIds"]
        assert source["id"] in root_ids
        assert output["id"] in root_ids
        assert root_ids.index(output["id"]) == root_ids.index(source["id"]) + 1
