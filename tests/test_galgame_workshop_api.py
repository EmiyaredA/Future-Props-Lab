from copy import deepcopy

import httpx
import pytest
from sqlalchemy import delete, update

from app.capabilities.asset_store.models import VisualAsset
from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.galgame_workshop.storage.models import (
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
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


def default_position_presets() -> list[dict]:
    return [
        {"id": "position-outer-left", "name": "极左", "x": 12.0, "y": 50.0},
        {"id": "position-left", "name": "左", "x": 25.0, "y": 50.0, "builtinKey": "left"},
        {
            "id": "position-center-left",
            "name": "中左",
            "x": 37.5,
            "y": 50.0,
            "builtinKey": "centerLeft",
        },
        {"id": "position-center", "name": "中", "x": 50.0, "y": 50.0, "builtinKey": "center"},
        {
            "id": "position-center-right",
            "name": "中右",
            "x": 62.5,
            "y": 50.0,
            "builtinKey": "centerRight",
        },
        {"id": "position-right", "name": "右", "x": 75.0, "y": 50.0, "builtinKey": "right"},
        {"id": "position-outer-right", "name": "极右", "x": 88.0, "y": 50.0},
    ]


def localized_story() -> dict:
    document = playable_story()
    document["localizations"] = {
        "sourceLocale": "zh-CN",
        "defaultLocale": "en-US",
        "targets": [
            {
                "locale": "en-US",
                "entries": [
                    {
                        "blockId": "block-dialogue",
                        "field": "text",
                        "sourceFingerprint": "v1-dialogue",
                        "text": "Only one clue can support the choice.",
                    },
                    {
                        "blockId": "block-branch",
                        "field": "choiceText",
                        "choiceId": "choice-device",
                        "sourceFingerprint": "v1-choice",
                        "text": "Inspect the device",
                    },
                ],
            }
        ],
    }
    return document


@pytest.mark.asyncio
async def test_galgame_workshop_story_edit_report_completion_and_conflicts() -> None:
    from tests.account_fixtures import clear_private_projects

    await clear_private_projects()
    async with SessionLocal() as session:
        await session.execute(delete(GalgameStoryDocument))
        await session.execute(
            delete(GalgameWorkshopProject).where(
                GalgameWorkshopProject.owner_user_id == "test-user"
            )
        )
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
            "schemaVersion": "1.4",
            "entryChapterId": "chapter-1",
            "synopsis": "",
            "characters": [],
            "characterAttributeTemplates": [],
            "sceneGroups": [],
            "scenes": [],
            "cgs": [],
            "variables": [],
            "assets": [],
            "presentation": {
                "dialogueBox": {
                    "preset": "dark",
                    "assetId": None,
                    "backgroundColor": "#080E18",
                    "textColor": "#FFFFFF",
                    "nameColor": "#FFFFFF",
                    "backgroundOpacity": 0.82,
                    "borderRadius": 12,
                    "fontScale": 1.0,
                    "layout": {
                        "mode": "boxed",
                        "widthPercent": 100.0,
                        "heightPercent": 22.0,
                        "bottomOffsetPercent": 0.0,
                        "contentInsetXPercent": 0.0,
                        "contentInsetTopPercent": 0.0,
                        "contentInsetBottomPercent": 0.0,
                    },
                    "background": {
                        "mode": "solid",
                        "gradientTopOpacity": 0.2,
                        "gradientBottomOpacity": 0.94,
                        "topRule": "none",
                        "topRuleColor": "#FFFFFF",
                        "topRuleOpacity": 0.22,
                    },
                    "body": {
                        "fontSizePx": None,
                        "lineHeight": 1.35,
                        "align": "left",
                        "maxWidthPercent": 100.0,
                    },
                    "speakerName": {
                        "placement": "topLeft",
                        "fontSizePx": None,
                        "decoration": "none",
                    },
                    "advanceIndicator": {
                        "visible": True,
                        "position": "bottomRight",
                        "style": "descriptive",
                        "showInExport": True,
                    },
                },
                "ui": {"components": []},
                "stage": {
                    "speakerFocusEnabled": True,
                    "inactiveBrightness": 0.6,
                    "focusTransitionMs": 180,
                    "lipSyncEnabled": False,
                },
                "text": {"defaultSpeedCps": 40},
                "paragraph": {
                    "defaultStyleRef": {"source": "builtin", "id": "classic"},
                    "customStyles": [],
                },
                "systemMessage": {
                    "binding": {
                        "source": "builtin",
                        "id": "standard-message",
                    },
                    "customStyles": [],
                },
            },
            "settings": {
                "canvas": {"width": 1920, "height": 1080},
                "characterStage": {
                    "anchor": "center",
                    "defaultPositionId": "position-center",
                    "defaultHeightPercent": 100.0,
                    "positionPresets": default_position_presets(),
                },
            },
            "chapters": [
                {
                    "id": "chapter-1",
                    "title": "第一章",
                    "order": 1,
                    "entryFragmentId": "main",
                    "disabled": False,
                    "fragments": [{"id": "main", "title": "main", "blocks": []}],
                }
            ],
        }

        blocked_report = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert blocked_report["ready"] is True
        assert blocked_report["errors"] == []

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

        missing_secondary_speaker = playable_story()
        missing_secondary_speaker["chapters"][0]["fragments"][0]["blocks"][1]["speakerIds"] = [
            "character-one",
            "missing-character",
        ]
        response = await client.put(
            f"/v1/galgame-workshop/projects/{created['id']}/story",
            json={"expected_revision": 0, "document": missing_secondary_speaker},
        )
        assert response.status_code == 422

        duplicate_speakers = playable_story()
        duplicate_speakers["chapters"][0]["fragments"][0]["blocks"][1]["speakerIds"] = [
            "character-one",
            "character-one",
        ]
        response = await client.put(
            f"/v1/galgame-workshop/projects/{created['id']}/story",
            json={"expected_revision": 0, "document": duplicate_speakers},
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
        assert story["document"]["schemaVersion"] == "1.4"
        assert story["document"]["chapters"][0]["entryFragmentId"] == "main"
        assert story["document"]["presentation"]["dialogueBox"]["preset"] == "dark"
        assert story["document"]["presentation"]["ui"]["components"] == []


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
        assert scene["layers"] == []
        assert "backgrounds" not in scene
        assert "backgroundId" not in scene_block
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": story["document"]},
        )
        assert saved.status_code == 200


@pytest.mark.asyncio
async def test_galgame_story_normalizes_legacy_variable_fields() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "旧变量工程"})
        ).json()
    legacy = playable_story()
    legacy["variables"] = [
        {
            "id": "investigation-method",
            "name": "investigationMethod",
            "displayName": "排查方法",
            "type": "string",
            "default": "",
            "defaultValue": "",
            "scope": "slot",
            "persistence": "slot",
            "description": "记录玩家选择的排查方法。",
        }
    ]
    async with SessionLocal() as session:
        await session.execute(
            update(GalgameStoryDocument)
            .where(GalgameStoryDocument.project_id == project["id"])
            .values(document=legacy)
        )
        await session.commit()
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        story_response = await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story")
        assert story_response.status_code == 200, story_response.text
        variable = story_response.json()["document"]["variables"][0]
        assert variable == {
            "id": "investigation-method",
            "name": "排查方法",
            "type": "string",
            "defaultValue": "",
            "persistence": "session",
            "description": "记录玩家选择的排查方法。",
        }
        report_response = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/story/report"
        )
        assert report_response.status_code == 200, report_response.text


@pytest.mark.asyncio
async def test_galgame_workshop_project_crud_sorting() -> None:
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

        wrong_default = playable_story()
        wrong_default["characters"][0]["expressions"] = []
        wrong_default["characters"][0]["defaultExpressionId"] = "neutral"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": wrong_default},
        )
        assert response.status_code == 422
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200


@pytest.mark.asyncio
async def test_galgame_story_validates_multicharacter_stage_blocks() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "多人舞台"})
        ).json()
        document = playable_story()
        document["characters"].append(
            {"id": "character-two", "name": "助手", "description": "观察舞台"}
        )
        blocks = document["chapters"][0]["fragments"][0]["blocks"]
        blocks[0]["clearCharacters"] = False
        blocks.insert(
            1,
            {
                "id": "block-show-assistant",
                "type": "showCharacter",
                "characterId": "character-two",
                "expressionId": None,
                "transform": {
                    "x": 75,
                    "y": 100,
                    "scale": 0.9,
                    "brightness": 0.8,
                    "opacity": 1,
                    "flipX": True,
                    "layer": 11,
                },
                "transition": {"durationMs": 300, "fade": True},
            },
        )
        blocks[2]["portrait"] = {
            "mode": "stage",
            "keepAfter": True,
            "transform": None,
            "transition": {"durationMs": 180, "fade": True},
        }
        blocks.insert(
            3,
            {
                "id": "block-remove-assistant",
                "type": "removeCharacter",
                "characterId": "character-two",
                "all": False,
                "transition": {"durationMs": 240, "fade": True},
            },
        )

        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        saved_blocks = saved.json()["document"]["chapters"][0]["fragments"][0]["blocks"]
        assert saved_blocks[0]["clearCharacters"] is False
        assert saved_blocks[1]["transform"]["x"] == 75
        assert saved_blocks[2]["portrait"]["mode"] == "stage"

        extended_transform = deepcopy(document)
        extended_transform["chapters"][0]["fragments"][0]["blocks"][1]["transform"].update(
            {"x": -1000, "y": 1000}
        )
        extended = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": extended_transform},
        )
        assert extended.status_code == 200, extended.text

        invalid_targets = deepcopy(document)
        invalid_targets["chapters"][0]["fragments"][0]["blocks"][3].update(
            {"all": True, "characterId": "character-two"}
        )
        invalid_transform = deepcopy(document)
        invalid_transform["chapters"][0]["fragments"][0]["blocks"][1]["transform"]["scale"] = 3.1
        invalid_position = deepcopy(document)
        invalid_position["chapters"][0]["fragments"][0]["blocks"][1]["transform"]["x"] = 1001
        missing_character = deepcopy(document)
        missing_character["chapters"][0]["fragments"][0]["blocks"][1]["characterId"] = (
            "missing-character"
        )

        for invalid in (invalid_targets, invalid_transform, invalid_position, missing_character):
            rejected = await client.put(
                f"/v1/galgame-workshop/projects/{project['id']}/story",
                json={"expected_revision": 2, "document": invalid},
            )
            assert rejected.status_code == 422, rejected.text


@pytest.mark.asyncio
async def test_galgame_dialogue_box_style_uses_a_typed_story_image() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\ndialogue-box-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "界面样式"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("dialogue-frame.png", png, "image/png")},
            )
        ).json()
        document = playable_story()
        document["assets"] = [
            {
                "id": "dialogue-frame-asset",
                "type": "image",
                "role": "dialogueBox",
                "fileId": uploaded["id"],
                "status": "ready",
            },
            {
                "id": "custom-ui-asset",
                "type": "image",
                "role": "uiComponent",
                "fileId": uploaded["id"],
                "status": "ready",
            },
        ]
        document["presentation"] = {
            "dialogueBox": {
                "preset": "custom",
                "assetId": "dialogue-frame-asset",
                "backgroundColor": "#172033",
                "textColor": "#F8FAFC",
                "nameColor": "#FB7185",
                "backgroundOpacity": 0.7,
                "borderRadius": 18,
                "fontScale": 1.1,
            },
            "ui": {
                "components": [
                    {
                        "id": "lab-status",
                        "name": "实验室状态",
                        "assetId": "custom-ui-asset",
                        "x": 7,
                        "y": 9,
                        "width": 28,
                        "visibility": "content",
                        "layer": 4,
                    }
                ]
            },
            "stage": {
                "speakerFocusEnabled": True,
                "inactiveBrightness": 0.6,
                "focusTransitionMs": 180,
                "lipSyncEnabled": False,
            },
        }
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        presentation = saved.json()["document"]["presentation"]
        assert presentation["dialogueBox"] == {
            **document["presentation"]["dialogueBox"],
            "layout": {
                "mode": "boxed",
                "widthPercent": 100.0,
                "heightPercent": 22.0,
                "bottomOffsetPercent": 0.0,
                "contentInsetXPercent": 0.0,
                "contentInsetTopPercent": 0.0,
                "contentInsetBottomPercent": 0.0,
            },
            "background": {
                "mode": "solid",
                "gradientTopOpacity": 0.2,
                "gradientBottomOpacity": 0.94,
                "topRule": "none",
                "topRuleColor": "#FFFFFF",
                "topRuleOpacity": 0.22,
            },
            "body": {
                "fontSizePx": None,
                "lineHeight": 1.35,
                "align": "left",
                "maxWidthPercent": 100.0,
            },
            "speakerName": {
                "placement": "topLeft",
                "fontSizePx": None,
                "decoration": "none",
            },
            "advanceIndicator": {
                "visible": True,
                "position": "bottomRight",
                "style": "descriptive",
                "showInExport": True,
            },
        }
        assert presentation["ui"] == document["presentation"]["ui"]
        assert presentation["stage"] == document["presentation"]["stage"]
        assert presentation["text"] == {"defaultSpeedCps": 40}
        assert presentation["paragraph"]["defaultStyleRef"] == {
            "source": "builtin",
            "id": "classic",
        }

        wrong_role = document.copy()
        wrong_role["assets"] = [
            document["assets"][0],
            {**document["assets"][1], "role": "sceneBackground"},
        ]
        rejected = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": wrong_role},
        )
        assert rejected.status_code == 422
        assert rejected.json()["code"] == "validation_error"

        legacy_document = playable_story()
        legacy_document["assets"] = [
            {
                "id": "legacy-hud-asset",
                "type": "image",
                "role": "dateHud",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        legacy_document["presentation"] = {"ui": {"dateHudAssetId": "legacy-hud-asset"}}
        migrated = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": legacy_document},
        )
        assert migrated.status_code == 200, migrated.text
        migrated_document = migrated.json()["document"]
        assert migrated_document["assets"][0]["role"] == "uiComponent"
        assert migrated_document["presentation"]["ui"]["components"][0] == {
            "id": "legacy-date-hud",
            "name": "日期 HUD",
            "assetId": "legacy-hud-asset",
            "x": 2.0,
            "y": 2.0,
            "width": 32.0,
            "visibility": "always",
            "layer": 3,
        }
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200


@pytest.mark.asyncio
async def test_galgame_scene_layers_validate_roles_groups_and_unique_ids() -> None:
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
        document["schemaVersion"] = "1.2"
        document["assets"] = [
            {
                "id": "background-night-asset",
                "type": "image",
                "role": "sceneLayer",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["scenes"][0]["layers"] = [
            {
                "id": "background-night",
                "name": "夜间",
                "assetId": "background-night-asset",
                "distance": 1,
                "offsetX": 0,
                "offsetY": 0,
            }
        ]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["document"]["scenes"][0]["layers"][0]["name"] == "夜间"

        wrong_role = playable_story()
        wrong_role["schemaVersion"] = "1.2"
        wrong_role["assets"] = [
            {
                "id": "portrait-asset",
                "type": "image",
                "role": "characterPortrait",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        wrong_role["scenes"][0]["layers"] = [
            {"id": "background-night", "name": "夜间", "assetId": "portrait-asset"}
        ]
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": wrong_role},
        )
        assert response.status_code == 422

        cross_scene = playable_story()
        cross_scene["schemaVersion"] = "1.2"
        cross_scene["assets"] = document["assets"]
        cross_scene["scenes"][0].update(document["scenes"][0])
        cross_scene["scenes"][0]["groupId"] = "missing-group"
        response = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": cross_scene},
        )
        assert response.status_code == 422

        duplicate = playable_story()
        duplicate["schemaVersion"] = "1.2"
        duplicate["assets"] = document["assets"]
        duplicate["scenes"][0]["layers"] = [
            {"id": "background-night", "name": "夜间", "assetId": "background-night-asset"},
            {"id": "background-night", "name": "雨夜", "assetId": "background-night-asset"},
        ]
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
