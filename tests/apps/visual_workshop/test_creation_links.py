"""Project links keep owner scope, CAS, source selections and shot-only staging."""

from io import BytesIO
from uuid import uuid4

import httpx
import pytest

from studio.apps.visual_workshop.creation_links.records import CreationLinkRecords
from studio.apps.visual_workshop.creation_links.schemas import CreationLinksUpdate
from studio.apps.visual_workshop.storyboard.schemas import ShotPrevis
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal, app

ROOT = "/v1/visual-workshop/projects"
DOC = {
    "version": 1,
    "objects": [{"id": "actor", "name": "Actor"}],
    "gridVisible": True,
    "view": {"position": {"x": 1, "y": 1, "z": 1}, "target": {"x": 0, "y": 0, "z": 0}},
}


async def test_creation_links_project_scope_cas_and_object_identity():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (await client.post(ROOT, json={"title": "联动", "kind": "canvas"})).json()
        root = f"{ROOT}/{project['id']}"
        other = (await client.post(ROOT, json={"title": "隔离", "kind": "canvas"})).json()
        stage = (
            await client.post(
                root + "/previs-scenes",
                json={"title": "会客室", "format_version": 1, "document": DOC},
            )
        ).json()
        cards = [
            (
                await client.post(
                    "/v1/visual-workshop/asset-cards", json={"title": kind, "kind": kind}
                )
            ).json()
            for kind in ("scene", "character", "prop")
        ]
        body = {
            "expected_revision": 0,
            "scenes": [{"card_id": cards[0]["id"], "previs_scene_id": stage["id"]}],
            "objects": [
                {"card_id": cards[1]["id"], "previs_scene_id": stage["id"], "object_id": "actor"}
            ],
        }
        assert (await client.put(root + "/creation-links", json=body)).status_code == 422
        assert (
            await client.put(
                root + "/canvas",
                json={
                    "expected_revision": 0,
                    "nodes": [],
                    "project_card_ids": [card["id"] for card in cards],
                },
            )
        ).is_success
        saved = await client.put(root + "/creation-links", json=body)
        assert saved.is_success, saved.text
        assert (await client.put(root + "/creation-links", json=body)).status_code == 409
        assert (await client.get(root + "/creation-links")).json() == saved.json()
        foreign = f"{ROOT}/{other['id']}"
        assert (await client.put(foreign + "/creation-links", json=body)).status_code == 422
        invalid = {
            **body,
            "expected_revision": 1,
            "objects": [
                {"card_id": cards[2]["id"], "previs_scene_id": stage["id"], "object_id": "deleted"}
            ],
        }
        assert (await client.put(root + "/creation-links", json=invalid)).status_code == 422
        # Deleted historical targets are retained for explicit repair.
        assert (
            await client.delete(
                root + f"/previs-scenes/{stage['id']}",
                params={"expected_revision": stage["revision"]},
            )
        ).is_success
        assert (
            await client.put(root + "/creation-links", json={**body, "expected_revision": 1})
        ).is_success
        async with SessionLocal() as session:
            records = CreationLinkRecords(session, str(uuid4()))
            with pytest.raises(ProjectResourceError) as failure:
                await records.get(project["id"])
            assert failure.value.status == 404
            with pytest.raises(ProjectResourceError):
                await records.save(project["id"], CreationLinksUpdate(expected_revision=2))


async def test_shot_excerpt_utf16_scope_stage_conflict_and_snapshot_remapping():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (await client.post(ROOT, json={"title": "选段与预演", "kind": "canvas"})).json()
        root = f"{ROOT}/{project['id']}"
        scene_id = str(uuid4())
        episodes = [
            {
                "id": str(uuid4()),
                "title": "第一集",
                "scenes": [
                    {"id": scene_id, "title": "第一场", "text": "🙂开场对白", "heading": "内"}
                ],
            }
        ]
        assert (
            await client.put(root + "/script", json={"expected_revision": 0, "episodes": episodes})
        ).is_success
        stage = (
            await client.post(
                root + "/previs-scenes",
                json={"title": "舞台", "format_version": 1, "document": DOC},
            )
        ).json()
        shot = {
            "id": str(uuid4()),
            "title": "对白",
            "source": {
                "scene_id": scene_id,
                "revision": 1,
                "excerpt": "开场",
                "start": 2,
                "end": 4,
            },
            "previs": {
                "scene_id": stage["id"],
                "stage_revision": 0,
                "overrides": {"objects": [{"id": "actor", "position": {"x": 2, "y": 0, "z": 0}}]},
            },
        }
        saved = await client.put(
            root + "/storyboard", json={"expected_revision": 0, "shots": [shot]}
        )
        assert saved.is_success, saved.text
        wrong = {**shot, "source": {**shot["source"], "start": 1, "end": 3}}
        assert (
            await client.put(root + "/storyboard", json={"expected_revision": 1, "shots": [wrong]})
        ).status_code == 422
        updated = await client.put(
            root + f"/previs-scenes/{stage['id']}",
            json={"title": "修订", "format_version": 1, "document": DOC, "expected_revision": 0},
        )
        assert updated.is_success, updated.text
        changed = {**shot, "previs": {**shot["previs"], "overrides": {}}}
        assert (
            await client.put(
                root + "/storyboard", json={"expected_revision": 1, "shots": [changed]}
            )
        ).status_code == 409
        # Unchanged historical stage revision does not block unrelated shot edits.
        assert (
            await client.put(
                root + "/storyboard",
                json={"expected_revision": 1, "shots": [{**shot, "title": "对白修订"}]},
            )
        ).is_success
        snapshot = await client.get(root + "/snapshot")
        assert snapshot.is_success, snapshot.text
        copied = await client.post(
            ROOT + "/snapshot-imports",
            files={"file": ("copy.zip", BytesIO(snapshot.content), "application/zip")},
        )
        assert copied.is_success, copied.text
        copy_root = f"{ROOT}/{copied.json()['project']['id']}"
        target = (await client.get(copy_root + "/storyboard")).json()["shots"][0]
        stages = (await client.get(copy_root + "/previs-scenes")).json()
        assert target["previs"]["scene_id"] == stages[0]["id"] != stage["id"]
        assert target["previs"]["stage_revision"] == 0
        assert target["source"]["excerpt"] == "开场"
        assert target["previs"]["overrides"] == shot["previs"]["overrides"]


def test_shot_overrides_cannot_replace_shared_geometry_or_assets():
    for overrides in (
        {"terrain": {}},
        {"objects": [{"id": "actor", "asset": {}}]},
        {"life": {"path": "https://other"}},
    ):
        with pytest.raises(ValueError):
            ShotPrevis(scene_id=str(uuid4()), stage_revision=0, overrides=overrides)
