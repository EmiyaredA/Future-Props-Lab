from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import delete, update

import app.deps as deps
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.main import app
from app.models import (
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
    VisualAsset,
)


def playable_story() -> dict:
    return {
        "schemaVersion": "1.0",
        "synopsis": "一次会抵达两个不同答案的夜间调查。",
        "characters": [{"id": "character-one", "name": "调查员", "description": "保持冷静"}],
        "scenes": [{"id": "scene-lab", "name": "夜间研究所", "description": "灯光昏暗"}],
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
                        "title": "抉择",
                        "blocks": [
                            {"id": "block-scene", "type": "scene", "sceneId": "scene-lab"},
                            {
                                "id": "block-dialogue",
                                "type": "dialogue",
                                "characterId": "character-one",
                                "text": "线索只够支持一次选择。",
                            },
                            {
                                "id": "block-branch",
                                "type": "branch",
                                "prompt": "检查哪里？",
                                "choices": [
                                    {
                                        "id": "choice-device",
                                        "text": "检查设备",
                                        "targetFragmentId": "device-ending",
                                    },
                                    {
                                        "id": "choice-clock",
                                        "text": "检查时钟",
                                        "targetFragmentId": "clock-ending",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        "id": "device-ending",
                        "title": "设备结局",
                        "blocks": [
                            {
                                "id": "block-device-text",
                                "type": "narration",
                                "text": "设备留下了干扰痕迹。",
                            },
                            {
                                "id": "block-device-end",
                                "type": "endChapter",
                                "endingId": "ending-device",
                                "label": "设备的答案",
                            },
                        ],
                    },
                    {
                        "id": "clock-ending",
                        "title": "时钟结局",
                        "blocks": [
                            {
                                "id": "block-clock-text",
                                "type": "narration",
                                "text": "时间戳出现了偏差。",
                            },
                            {
                                "id": "block-clock-end",
                                "type": "endChapter",
                                "endingId": "ending-clock",
                                "label": "时间的答案",
                            },
                        ],
                    },
                ],
            }
        ],
    }


@pytest.mark.asyncio
async def test_galgame_workshop_story_edit_report_completion_and_conflicts() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(GalgameStoryDocument))
        await session.execute(delete(GalgameWorkshopProject))
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post("/v1/galgame-workshop/projects", json={"title": " 双结局实验 "})
        assert created.status_code == 200, created.text
        project = created.json()

        story_response = await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story")
        assert story_response.status_code == 200
        initial_story = story_response.json()
        assert initial_story["document"] == {
            "schemaVersion": "1.0",
            "synopsis": "",
            "characters": [],
            "scenes": [],
            "variables": [],
            "assets": [],
            "chapters": [
                {
                    "id": "chapter-1",
                    "title": "第一章",
                    "order": 1,
                    "entryFragmentId": "main",
                    "fragments": [{"id": "main", "title": "main", "blocks": []}],
                }
            ],
        }

        blocked_report = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert blocked_report["ready"] is False
        assert {issue["code"] for issue in blocked_report["errors"]} == {
            "open_fragment",
            "no_reachable_ending",
        }
        blocked_complete = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}",
            json={"expected_revision": 0, "status": "completed"},
        )
        assert blocked_complete.status_code == 422
        assert blocked_complete.json()["code"] == "story_not_ready"

        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": playable_story()},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1

        report = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert report["ready"] is True
        assert report["errors"] == []
        assert report["warnings"] == []
        assert report["chapters"][0]["reachable_fragment_ids"] == [
            "clock-ending",
            "device-ending",
            "main",
        ]
        assert report["chapters"][0]["ending_ids"] == [
            "ending-clock",
            "ending-device",
        ]

        completed = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}",
            json={"expected_revision": 0, "status": "completed"},
        )
        assert completed.status_code == 200
        assert completed.json()["status"] == "completed"

        changed = playable_story()
        changed["synopsis"] = "完成后继续编辑"
        resaved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": changed},
        )
        assert resaved.status_code == 200
        current_project = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}")
        ).json()
        assert current_project["status"] == "draft"
        assert current_project["revision"] == 2

        stale = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": playable_story()},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"
        assert stale.json()["current"]["revision"] == 2


@pytest.mark.asyncio
async def test_galgame_story_rejects_invalid_references_and_reports_route_risks() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "结构检查"})
        ).json()
        invalid = playable_story()
        invalid["chapters"][0]["fragments"][0]["blocks"][1]["characterId"] = "missing-character"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{created['id']}/story",
            json={"expected_revision": 0, "document": invalid},
        )
        assert response.status_code == 422

        duplicate = playable_story()
        duplicate["chapters"][0]["fragments"][1]["blocks"][0]["id"] = "block-dialogue"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{created['id']}/story",
            json={"expected_revision": 0, "document": duplicate},
        )
        assert response.status_code == 422

        risky = playable_story()
        risky["chapters"][0]["fragments"].append(
            {
                "id": "unused-draft",
                "title": "未接入草稿",
                "blocks": [
                    {
                        "id": "unused-end",
                        "type": "endChapter",
                        "endingId": "ending-unused",
                        "label": "未接入",
                    }
                ],
            }
        )
        risky["chapters"][0]["fragments"][1]["blocks"].append(
            {"id": "dead-text", "type": "narration", "text": "不会执行"}
        )
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{created['id']}/story",
            json={"expected_revision": 0, "document": risky},
        )
        assert saved.status_code == 200
        report = (
            await client.get(f"/v1/galgame-workshop/projects/{created['id']}/story/report")
        ).json()
        assert {issue["code"] for issue in report["errors"]} == {
            "dead_blocks",
            "unreachable_fragment",
        }

        trapped = playable_story()
        trapped_branch = trapped["chapters"][0]["fragments"][0]["blocks"][-1]
        trapped_branch["choices"] = [
            {
                "id": "choice-loop-one",
                "text": "继续兜圈",
                "targetFragmentId": "main",
            },
            {
                "id": "choice-loop-two",
                "text": "还是兜圈",
                "targetFragmentId": "main",
            },
        ]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{created['id']}/story",
            json={"expected_revision": 1, "document": trapped},
        )
        assert saved.status_code == 200
        report = (
            await client.get(f"/v1/galgame-workshop/projects/{created['id']}/story/report")
        ).json()
        assert "trapped_cycle" in {issue["code"] for issue in report["errors"]}
        assert report["chapters"][0]["cycles"] == [["main"]]


@pytest.mark.asyncio
async def test_galgame_story_normalizes_the_legacy_empty_skeleton() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "旧工程"})
        ).json()
    async with SessionLocal() as session:
        await session.execute(
            update(GalgameStoryDocument)
            .where(GalgameStoryDocument.project_id == project["id"])
            .values(
                document={
                    "synopsis": "",
                    "chapters": [],
                    "characters": [],
                    "scenes": [],
                }
            )
        )
        await session.commit()
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        story = (await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story")).json()
        assert story["document"]["schemaVersion"] == "1.0"
        assert story["document"]["chapters"][0]["entryFragmentId"] == "main"


@pytest.mark.asyncio
async def test_galgame_story_normalizes_legacy_scene_background_fields() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "旧场景工程"})
        ).json()
    legacy = playable_story()
    async with SessionLocal() as session:
        await session.execute(
            update(GalgameStoryDocument)
            .where(GalgameStoryDocument.project_id == project["id"])
            .values(document=legacy)
        )
        await session.commit()
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        story = (await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story")).json()
        scene = story["document"]["scenes"][0]
        scene_block = story["document"]["chapters"][0]["fragments"][0]["blocks"][0]
        assert scene["backgrounds"] == []
        assert scene["defaultBackgroundId"] is None
        assert scene_block["backgroundId"] is None
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": story["document"]},
        )
        assert saved.status_code == 200


@pytest.mark.asyncio
async def test_galgame_workshop_project_crud_sorting_and_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "第一个工程"})
        ).json()
        second = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "第二个工程"})
        ).json()
        listed = (await client.get("/v1/galgame-workshop/projects")).json()["items"]
        assert [item["id"] for item in listed[:2]] == [second["id"], first["id"]]
        deleted = await client.delete(
            f"/v1/galgame-workshop/projects/{second['id']}",
            params={"expected_revision": second["revision"]},
        )
        assert deleted.json() == {"deleted": True}

    token = "g" * 32
    monkeypatch.setattr(
        deps,
        "get_settings",
        lambda: SimpleNamespace(fpl_studio_token=token),
    )
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/v1/galgame-workshop/projects")).status_code == 401
        authorized = await client.get(
            "/v1/galgame-workshop/projects", headers={"X-Studio-Token": token}
        )
        assert authorized.status_code == 200


@pytest.mark.asyncio
async def test_galgame_character_portraits_private_assets_and_library_references() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\nportrait-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "立绘工程"})
        ).json()
        second = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "其他工程"})
        ).json()
        uploaded = await client.post(
            f"/v1/galgame-workshop/projects/{first['id']}/assets",
            files={"upload": ("investigator.png", png, "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        private_asset = uploaded.json()
        listed = (await client.get(f"/v1/galgame-workshop/projects/{first['id']}/assets")).json()
        assert [item["id"] for item in listed["items"]] == [private_asset["id"]]

        document = playable_story()
        document["assets"] = [
            {
                "id": "portrait-neutral",
                "type": "image",
                "role": "characterPortrait",
                "fileId": private_asset["id"],
                "status": "ready",
            }
        ]
        document["characters"][0]["expressions"] = [
            {"id": "neutral", "label": "平静", "assetId": "portrait-neutral"}
        ]
        document["characters"][0]["defaultExpressionId"] = "neutral"
        document["chapters"][0]["fragments"][0]["blocks"][1]["expressionId"] = "neutral"
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{first['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        in_use = await client.delete(
            f"/v1/galgame-workshop/projects/{first['id']}/assets/{private_asset['id']}",
            params={"expected_revision": private_asset["revision"]},
        )
        assert in_use.status_code == 409
        assert in_use.json()["code"] == "asset_in_use"

        cross_project = await client.put(
            f"/v1/galgame-workshop/projects/{second['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert cross_project.status_code == 422
        assert cross_project.json()["code"] == "invalid_story_document"

        library_upload = await client.post(
            "/v1/files",
            files={"upload": ("shared.png", png, "image/png")},
        )
        assert library_upload.status_code == 200
        library_asset = library_upload.json()
        document["assets"][0]["fileId"] = library_asset["id"]
        rebound = await client.put(
            f"/v1/galgame-workshop/projects/{first['id']}/story",
            json={"expected_revision": 1, "document": document},
        )
        assert rebound.status_code == 200, rebound.text
        protected = await client.delete(
            f"/v1/files/{library_asset['id']}",
            params={"expected_revision": library_asset["revision"]},
        )
        assert protected.status_code == 409
        assert protected.json()["code"] == "asset_in_use"

        cleared = await client.put(
            f"/v1/galgame-workshop/projects/{first['id']}/story",
            json={"expected_revision": 2, "document": playable_story()},
        )
        assert cleared.status_code == 200
        released = await client.delete(
            f"/v1/files/{library_asset['id']}",
            params={"expected_revision": library_asset["revision"]},
        )
        assert released.status_code == 200
        removed_private = await client.delete(
            f"/v1/galgame-workshop/projects/{first['id']}/assets/{private_asset['id']}",
            params={"expected_revision": private_asset["revision"]},
        )
        assert removed_private.status_code == 200

        await client.delete(
            f"/v1/galgame-workshop/projects/{first['id']}",
            params={"expected_revision": first["revision"]},
        )
        await client.delete(
            f"/v1/galgame-workshop/projects/{second['id']}",
            params={"expected_revision": second["revision"]},
        )

    async with SessionLocal() as session:
        assert await session.get(VisualAsset, private_asset["id"]) is None
        assert (
            await session.scalar(GalgameProjectAssetReference.__table__.select().limit(1)) is None
        )


@pytest.mark.asyncio
async def test_galgame_story_rejects_invalid_character_expressions() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "表情校验"})
        ).json()
        missing_asset = playable_story()
        missing_asset["characters"][0]["expressions"] = [
            {"id": "neutral", "label": "平静", "assetId": "missing-portrait"}
        ]
        missing_asset["characters"][0]["defaultExpressionId"] = "neutral"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": missing_asset},
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_galgame_scene_backgrounds_validate_roles_and_block_ownership() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\nbackground-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "背景校验"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("night.png", png, "image/png")},
            )
        ).json()

        document = playable_story()
        document["assets"] = [
            {
                "id": "background-night-asset",
                "type": "image",
                "role": "sceneBackground",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["scenes"][0]["backgrounds"] = [
            {
                "id": "background-night",
                "label": "夜间",
                "assetId": "background-night-asset",
            }
        ]
        document["scenes"][0]["defaultBackgroundId"] = "background-night"
        document["chapters"][0]["fragments"][0]["blocks"][0]["backgroundId"] = "background-night"
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["document"]["scenes"][0]["backgrounds"][0]["label"] == "夜间"
        assert (
            saved.json()["document"]["chapters"][0]["fragments"][0]["blocks"][0]["backgroundId"]
            == "background-night"
        )

        wrong_role = playable_story()
        wrong_role["assets"] = [
            {
                "id": "portrait-asset",
                "type": "image",
                "role": "characterPortrait",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        wrong_role["scenes"][0]["backgrounds"] = [
            {"id": "background-night", "label": "夜间", "assetId": "portrait-asset"}
        ]
        wrong_role["scenes"][0]["defaultBackgroundId"] = "background-night"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": wrong_role},
        )
        assert response.status_code == 422

        cross_scene = playable_story()
        cross_scene["assets"] = document["assets"]
        cross_scene["scenes"][0].update(document["scenes"][0])
        cross_scene["scenes"].append(
            {
                "id": "scene-roof",
                "name": "天台",
                "description": "",
                "backgrounds": [],
                "defaultBackgroundId": None,
            }
        )
        cross_scene["chapters"][0]["fragments"][0]["blocks"][0].update(
            {"sceneId": "scene-roof", "backgroundId": "background-night"}
        )
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": cross_scene},
        )
        assert response.status_code == 422

        duplicate = playable_story()
        duplicate["assets"] = document["assets"]
        duplicate["scenes"][0]["backgrounds"] = [
            {"id": "background-night", "label": "夜间", "assetId": "background-night-asset"},
            {"id": "background-night", "label": "雨夜", "assetId": "background-night-asset"},
        ]
        duplicate["scenes"][0]["defaultBackgroundId"] = "background-night"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": duplicate},
        )
        assert response.status_code == 422
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200


@pytest.mark.asyncio
async def test_galgame_scene_background_missing_file_blocks_completion() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\nbackground-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "背景文件检查"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("day.png", png, "image/png")},
            )
        ).json()
        document = playable_story()
        document["assets"] = [
            {
                "id": "background-day-asset",
                "type": "image",
                "role": "sceneBackground",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["scenes"][0]["backgrounds"] = [
            {
                "id": "background-day",
                "label": "白昼",
                "assetId": "background-day-asset",
            }
        ]
        document["scenes"][0]["defaultBackgroundId"] = "background-day"
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

    async with SessionLocal() as session:
        row = await session.get(VisualAsset, uploaded["id"])
        assert row is not None
        (get_settings().visual_asset_path / row.storage_key).unlink()

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        report = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert report["ready"] is False
        assert "missing_asset_file" in {issue["code"] for issue in report["errors"]}
        blocked = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}",
            json={"expected_revision": project["revision"], "status": "completed"},
        )
        assert blocked.status_code == 422
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200

        wrong_default = playable_story()
        wrong_default["characters"][0]["expressions"] = []
        wrong_default["characters"][0]["defaultExpressionId"] = "neutral"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": wrong_default},
        )
        assert response.status_code == 422
