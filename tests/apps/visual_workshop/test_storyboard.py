"""Shot plans retain edits, enforce scope and travel with portable projects."""

import sqlite3
from io import BytesIO
from uuid import uuid4

import httpx
import pytest

from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.visual_workshop.storyboard.records import SqlStoryboardRecords
from studio.apps.visual_workshop.storyboard.schemas import StoryboardUpdate
from studio.runtime.database.migrations import apply
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal, app

PROJECTS = "/v1/visual-workshop/projects"


async def test_storyboard_cas_links_sources_and_deleted_nodes_round_trip():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (await client.post(PROJECTS, json={"title": "镜头设计", "kind": "canvas"})).json()
        root = f"{PROJECTS}/{project['id']}"
        assert (await client.get(root + "/storyboard")).json() == {"shots": [], "revision": 0}
        nodes = [
            {"id": key, "kind": kind, "title": key, "position": {"x": index * 500, "y": 0}}
            for index, (key, kind) in enumerate((("frame", "image"), ("clip", "video")))
        ]
        canvas = await client.put(root + "/canvas", json={"expected_revision": 0, "nodes": nodes})
        assert canvas.is_success, canvas.text
        scene = str(uuid4())
        script = await client.put(
            root + "/script",
            json={
                "expected_revision": 0,
                "episodes": [
                    {
                        "id": str(uuid4()),
                        "title": "第一集",
                        "scenes": [
                            {"id": scene, "title": "雨夜", "heading": "外景", "text": "开场"}
                        ],
                    }
                ],
            },
        )
        assert script.is_success, script.text
        card = (
            await client.post(
                "/v1/visual-workshop/asset-cards", json={"title": "雨衣", "kind": "prop"}
            )
        ).json()
        shot = {
            "id": str(uuid4()),
            "title": "推门",
            "description": "人物推门进入",
            "duration": 3.5,
            "image_node_id": "frame",
            "video_node_id": "clip",
            "origin_node_id": "frame",
            "source": {"scene_id": scene, "revision": 1},
            "card_ids": [card["id"]],
        }
        body = {"expected_revision": 0, "shots": [shot]}
        assert (await client.put(root + "/storyboard", json=body)).status_code == 422
        assert (
            await client.put(
                root + "/canvas",
                json={"expected_revision": 1, "nodes": nodes, "project_card_ids": [card["id"]]},
            )
        ).is_success
        saved = await client.put(root + "/storyboard", json=body)
        assert saved.is_success, saved.text
        assert saved.json()["revision"] == 1
        assert (await client.put(root + "/storyboard", json=body)).status_code == 409
        assert (await client.get(root + "/storyboard")).json() == saved.json()
        for invalid in (
            {"video_node_id": "frame"},
            {"image_node_id": "foreign"},
            {"source": {"scene_id": scene, "revision": 0}},
        ):
            assert (
                await client.put(
                    root + "/storyboard",
                    json={"expected_revision": 1, "shots": [{**shot, **invalid}]},
                )
            ).status_code in (409, 422)
        # Source changes preserve shot content; deleted production links remain repairable.
        assert (
            await client.put(root + "/script", json={"expected_revision": 1, "episodes": []})
        ).is_success
        assert (
            await client.put(root + "/canvas", json={"expected_revision": 2, "nodes": []})
        ).is_success
        updated = await client.put(
            root + "/storyboard",
            json={"expected_revision": 1, "shots": [{**shot, "title": "推门（修订）"}]},
        )
        assert updated.is_success, updated.text
        assert {key: updated.json()["shots"][0]["source"][key] for key in shot["source"]} == shot[
            "source"
        ]
        assert (
            await client.delete(root, params={"expected_revision": project["revision"]})
        ).is_success


async def test_storyboard_snapshot_relinks_nodes_and_preserves_old_archives():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post(PROJECTS, json={"title": "可移植分镜", "kind": "canvas"})
        ).json()
        root = f"{PROJECTS}/{project['id']}"
        assert (
            await client.put(
                root + "/canvas",
                json={
                    "expected_revision": 0,
                    "nodes": [
                        {
                            "id": "frame",
                            "kind": "image",
                            "title": "画面",
                            "position": {"x": 0, "y": 0},
                        }
                    ],
                },
            )
        ).is_success
        assert (
            await client.put(
                root + "/storyboard",
                json={
                    "expected_revision": 0,
                    "shots": [{"id": str(uuid4()), "title": "开场", "image_node_id": "frame"}],
                },
            )
        ).is_success
        snapshot = await client.get(root + "/snapshot")
        assert snapshot.is_success, snapshot.text
        copied = await client.post(
            PROJECTS + "/snapshot-imports",
            files={"file": ("copy.zip", BytesIO(snapshot.content), "application/zip")},
        )
        assert copied.is_success, copied.text
        copy_root = f"{PROJECTS}/{copied.json()['project']['id']}"
        shots = (await client.get(copy_root + "/storyboard")).json()
        canvas = (await client.get(copy_root + "/canvas")).json()
        assert shots["shots"][0]["title"] == "开场"
        assert shots["shots"][0]["image_node_id"] == canvas["nodes"][0]["id"]
        async with SessionLocal() as session:
            records = SqlStoryboardRecords(session, str(uuid4()))
            with pytest.raises(ProjectResourceError) as error:
                await records.get(project["id"])
            assert error.value.status == 404
            with pytest.raises(ProjectResourceError):
                await records.save(project["id"], StoryboardUpdate(expected_revision=1, shots=[]))


def test_storyboard_registered_migration_is_additive_and_repeatable(tmp_path):
    path = tmp_path / "visual.db"
    apply(path, "visual", MIGRATIONS[:-1])
    with sqlite3.connect(path) as db:
        before = db.execute("SELECT COUNT(*) FROM visual_canvas_documents").fetchone()[0]
    apply(path, "visual", MIGRATIONS)
    apply(path, "visual", MIGRATIONS)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM visual_storyboards").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM visual_canvas_documents").fetchone()[0] == before
