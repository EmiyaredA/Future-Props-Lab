"""Visual previs uses project ownership, revision checks, and canvas receipts."""

import hashlib
import json
from io import BytesIO
from uuid import uuid4

import httpx
from PIL import Image
from sqlalchemy import select

from studio.apps.visual_workshop.previs_scenes import PrevisScenes
from studio.apps.visual_workshop.storage.models import VisualPrevisScene
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal, app

PROJECTS = "/v1/visual-workshop/projects"
SCENE = {
    "format_version": 1,
    "title": "室内对话",
    "document": {
        "version": 1,
        "objects": [],
        "gridVisible": False,
        "view": {"position": {"x": 9, "y": 7, "z": 11}, "target": {"x": 0, "y": 0.5, "z": 0}},
    },
}


async def test_previs_scene_conflicts_snapshot_and_idempotent_publication():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:

        async def create_project():
            response = await client.post(PROJECTS, json={"title": "镜头预演", "kind": "video"})
            assert response.status_code == 200, response.text
            return response.json()

        project, other = await create_project(), await create_project()
        path = f"{PROJECTS}/{project['id']}"
        scenes = f"{path}/previs-scenes"
        listing = await client.get(scenes)
        assert listing.status_code == 200, listing.text
        assert listing.json() == []
        created = await client.post(scenes, json=SCENE)
        assert created.status_code == 201, created.text
        scene_id = created.json()["id"]
        scene_path = f"{scenes}/{scene_id}"
        assert (
            await client.get(f"{PROJECTS}/{other['id']}/previs-scenes/{scene_id}")
        ).status_code == 404
        async with SessionLocal() as session:
            try:
                await PrevisScenes(session, "other-account").get(project["id"], scene_id)
            except ProjectResourceError as error:
                assert error.status == 404
            else:
                raise AssertionError("scene was visible to a different account")
        updated = {**SCENE, "title": "三镜场景", "expected_revision": 0}
        saved = await client.put(scene_path, json=updated)
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert (await client.put(scene_path, json=updated)).status_code == 409
        assert (await client.delete(scene_path, params={"expected_revision": 0})).status_code == 409
        invalid = await client.post(
            scenes,
            json={
                **SCENE,
                "document": {
                    **SCENE["document"],
                    "objects": [{"asset": {"url": "http://example.test/model.glb"}}],
                },
            },
        )
        assert invalid.status_code == 422, invalid.text

        stream = BytesIO()
        Image.new("RGB", (16, 16), "red").save(stream, "PNG")
        frame = stream.getvalue()
        source = {
            "request_id": str(uuid4()),
            "scene_id": scene_id,
            "scene_revision": 1,
            "shot_number": 1,
            "sha256": hashlib.sha256(frame).hexdigest(),
        }

        async def upload(provenance, revision=0):
            return await client.post(
                f"{path}/node-uploads",
                data={
                    "expected_revision": revision,
                    "x": 40,
                    "y": 25,
                    "previs": json.dumps(provenance),
                },
                files={"file": ("第1镜.png", frame, "image/png")},
            )

        assert (await upload({**source, "scene_revision": 0})).status_code == 409
        assert (await upload({**source, "sha256": "0" * 64})).status_code == 422
        published = await upload(source)
        assert published.status_code == 200, published.text
        assert published.json()["nodes"][0]["tags"] == ["白模预演", f"{scene_id}@1", "第1镜"]
        repeated = await upload(source)
        assert repeated.json() == published.json()
        assert (await upload({**source, "shot_number": 2})).status_code == 409

        exported = await client.get(f"{path}/snapshot")
        assert exported.status_code == 200, exported.text
        imported = await client.post(
            f"{PROJECTS}/snapshot-imports",
            files={"file": ("previs.zip", exported.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        restored = f"{PROJECTS}/{imported.json()['project']['id']}/previs-scenes"
        result = (await client.get(restored)).json()
        assert len(result) == 1 and result[0]["title"] == "三镜场景"
        reloaded = await client.get(f"{restored}/{result[0]['id']}")
        assert reloaded.json()["document"] == SCENE["document"]

        before_delete = await client.get(path)
        response = await client.delete(
            path, params={"expected_revision": before_delete.json()["revision"]}
        )
        assert response.status_code in (200, 204), response.text
        async with SessionLocal() as session:
            assert (
                await session.scalar(
                    select(VisualPrevisScene).where(VisualPrevisScene.id == scene_id)
                )
                is None
            )
