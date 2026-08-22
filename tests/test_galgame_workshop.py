from copy import deepcopy

import httpx
import pytest
from sqlalchemy import delete, update

from app.core.db import SessionLocal
from app.galgame_workshop.story import build_route_report
from app.main import app
from app.models import (
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.galgame_workshop import GalgameStoryProject


def test_galgame_timeline_master_audio_schema_is_optional_and_role_checked() -> None:
    legacy = GalgameStoryProject.model_validate(playable_story())
    assert legacy.chapters[0].fragments[0].timeline is None

    document = playable_story()
    document["assets"] = [
        {
            "id": "complete-drama",
            "type": "audio",
            "role": "timelineMaster",
            "label": "完整广播剧",
            "fileId": "audio-file-id",
            "status": "ready",
        }
    ]
    fragment = document["chapters"][0]["fragments"][0]
    fragment["timeline"] = {
        "durationMs": 20_000,
        "masterAudio": {"assetId": "complete-drama", "volume": 88},
    }
    fragment["blocks"][1].update({"startMs": 1_000, "endMs": 6_000})
    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)
    assert normalized["chapters"][0]["fragments"][0]["timeline"]["masterAudio"] == {
        "assetId": "complete-drama",
        "volume": 88,
    }

    missing = deepcopy(document)
    missing["chapters"][0]["fragments"][0]["timeline"]["masterAudio"]["assetId"] = "missing"
    with pytest.raises(ValueError, match="主音轨引用了不存在"):
        GalgameStoryProject.model_validate(missing)

    wrong_role = deepcopy(document)
    wrong_role["assets"][0]["role"] = "voiceLine"
    with pytest.raises(ValueError, match="timelineMaster"):
        GalgameStoryProject.model_validate(wrong_role)


def test_galgame_stage_cast_and_sprite_motion_contracts() -> None:
    document = playable_story()
    document["characters"].extend(
        [
            {"id": "character-two", "name": "助手"},
            {"id": "character-three", "name": "访客"},
        ]
    )
    document["chapters"][0]["fragments"][0]["blocks"].insert(
        1,
        {
            "id": "cast",
            "type": "setStageCast",
            "members": [
                {
                    "characterId": "character-one",
                    "distance": "near",
                    "positionId": "position-left",
                    "transform": {"scale": 1.15},
                },
                {
                    "characterId": "character-two",
                    "distance": "far",
                    "positionId": "position-right",
                },
            ],
            "exitTransition": {"durationMs": 320, "fade": True},
        },
    )
    document["chapters"][0]["fragments"][0]["blocks"].insert(
        2,
        {
            "id": "tug",
            "type": "animateSprite",
            "characterId": "character-one",
            "animation": "tug",
            "direction": "right",
            "intensity": 1.4,
            "easing": "easeOut",
        },
    )

    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)
    cast = normalized["chapters"][0]["fragments"][0]["blocks"][1]
    motion = normalized["chapters"][0]["fragments"][0]["blocks"][2]
    assert len(cast["members"]) == 2
    assert cast["members"][0]["transform"]["scale"] == 1.15
    assert motion["direction"] == "right"
    assert motion["intensity"] == 1.4

    duplicate = deepcopy(document)
    duplicate["chapters"][0]["fragments"][0]["blocks"][1]["members"][1]["characterId"] = (
        "character-one"
    )
    with pytest.raises(ValueError, match="不能重复放置角色"):
        GalgameStoryProject.model_validate(duplicate)

    overcrowded = deepcopy(document)
    overcrowded["characters"].append({"id": "character-four", "name": "路人"})
    overcrowded["chapters"][0]["fragments"][0]["blocks"][1]["members"].extend(
        [
            {"characterId": "character-three"},
            {"characterId": "character-four"},
        ]
    )
    with pytest.raises(ValueError):
        GalgameStoryProject.model_validate(overcrowded)


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


def test_galgame_story_localization_schema_and_legacy_compatibility() -> None:
    legacy = GalgameStoryProject.model_validate(playable_story())
    assert legacy.localizations is None

    localized = GalgameStoryProject.model_validate(localized_story()).model_dump(
        mode="json", by_alias=True
    )
    assert localized["localizations"]["defaultLocale"] == "en-US"
    assert localized["localizations"]["targets"][0]["entries"][1]["choiceId"] == ("choice-device")

    invalid_cases: list[dict] = []
    invalid_locale = localized_story()
    invalid_locale["localizations"]["targets"][0]["locale"] = "not_a_locale"
    invalid_cases.append(invalid_locale)

    duplicate_locale = localized_story()
    duplicate_locale["localizations"]["targets"].append({"locale": "EN-us", "entries": []})
    invalid_cases.append(duplicate_locale)

    duplicate_entry = localized_story()
    duplicate_entry["localizations"]["targets"][0]["entries"].append(
        deepcopy(duplicate_entry["localizations"]["targets"][0]["entries"][0])
    )
    invalid_cases.append(duplicate_entry)

    missing_choice_id = localized_story()
    del missing_choice_id["localizations"]["targets"][0]["entries"][1]["choiceId"]
    invalid_cases.append(missing_choice_id)

    invalid_choice = localized_story()
    invalid_choice["localizations"]["targets"][0]["entries"][1]["choiceId"] = "missing-choice"
    invalid_cases.append(invalid_choice)

    invalid_field = localized_story()
    invalid_field["localizations"]["targets"][0]["entries"][0]["field"] = "label"
    invalid_cases.append(invalid_field)

    for invalid in invalid_cases:
        with pytest.raises(ValueError):
            GalgameStoryProject.model_validate(invalid)


@pytest.mark.asyncio
async def test_galgame_story_localizations_round_trip_with_revision_cas() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "多语言往返"})
        ).json()
        first = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": localized_story()},
        )
        assert first.status_code == 200, first.text
        assert (
            first.json()["document"]["localizations"]["targets"][0]["entries"][0]["text"]
            == "Only one clue can support the choice."
        )

        changed = localized_story()
        changed["localizations"]["targets"][0]["entries"][0]["text"] = "Updated text"
        second = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": changed},
        )
        assert second.status_code == 200
        assert second.json()["revision"] == 2

        stale = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": localized_story()},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"


def test_galgame_story_defaults_character_themes_and_stage_settings() -> None:
    document = playable_story()
    document["characters"].append(
        {"id": "character-two", "name": "助手", "description": "协同行动"}
    )

    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)

    assert [character["themeColor"] for character in normalized["characters"]] == [
        "#E75B55",
        "#4AA3DF",
    ]
    assert normalized["settings"] == {
        "canvas": {"width": 1920, "height": 1080},
        "characterStage": {
            "anchor": "center",
            "defaultPositionId": "position-center",
            "defaultHeightPercent": 100.0,
            "positionPresets": [
                {"id": "position-outer-left", "name": "极左", "x": 12.0, "y": 50.0},
                {"id": "position-left", "name": "左", "x": 25.0, "y": 50.0, "builtinKey": "left"},
                {
                    "id": "position-center-left",
                    "name": "中左",
                    "x": 37.5,
                    "y": 50.0,
                    "builtinKey": "centerLeft",
                },
                {
                    "id": "position-center",
                    "name": "中",
                    "x": 50.0,
                    "y": 50.0,
                    "builtinKey": "center",
                },
                {
                    "id": "position-center-right",
                    "name": "中右",
                    "x": 62.5,
                    "y": 50.0,
                    "builtinKey": "centerRight",
                },
                {"id": "position-right", "name": "右", "x": 75.0, "y": 50.0, "builtinKey": "right"},
                {"id": "position-outer-right", "name": "极右", "x": 88.0, "y": 50.0},
            ],
        },
    }

    invalid_canvas = deepcopy(document)
    invalid_canvas["settings"] = {"canvas": {"width": 320, "height": 1080}}
    with pytest.raises(ValueError, match="greater than or equal to 640"):
        GalgameStoryProject.model_validate(invalid_canvas)

    invalid_scale = deepcopy(document)
    invalid_scale["settings"] = {"characterStage": {"defaultScale": 0}}
    with pytest.raises(ValueError, match="greater than 0"):
        GalgameStoryProject.model_validate(invalid_scale)

    invalid_theme = deepcopy(document)
    invalid_theme["characters"][0]["themeColor"] = "red"
    with pytest.raises(ValueError, match="String should match pattern"):
        GalgameStoryProject.model_validate(invalid_theme)

    invalid_positions = deepcopy(document)
    invalid_positions["settings"] = {
        "characterStage": {
            "positionPresets": normalized["settings"]["characterStage"]["positionPresets"]
            + [
                {
                    "id": "position-left",
                    "name": "自定义",
                    "x": 100,
                    "y": 100,
                }
            ]
        }
    }
    with pytest.raises(ValueError, match="ID 不能重复"):
        GalgameStoryProject.model_validate(invalid_positions)

    character_override = deepcopy(document)
    character_override["settings"] = {
        "characterStageOverrides": {
            "character-one": {
                "anchor": "topLeft",
                "defaultHeightPercent": 135,
                "defaultPositionId": "position-center",
                "positionPresets": default_position_presets(),
            }
        }
    }
    parsed_override = GalgameStoryProject.model_validate(character_override).model_dump(
        mode="json", by_alias=True
    )
    assert parsed_override["settings"]["characterStageOverrides"]["character-one"] == {
        "anchor": "topLeft",
        "defaultPositionId": "position-center",
        "defaultHeightPercent": 135.0,
        "positionPresets": default_position_presets(),
    }

    unknown_override = deepcopy(character_override)
    unknown_override["settings"]["characterStageOverrides"] = {
        "missing-character": character_override["settings"]["characterStageOverrides"][
            "character-one"
        ]
    }
    with pytest.raises(ValueError, match="独立方案引用了不存在的角色"):
        GalgameStoryProject.model_validate(unknown_override)


def test_story_12_migrates_position_presets_and_preserves_legacy_block_anchor() -> None:
    document = playable_story()
    document["schemaVersion"] = "1.2"
    document["settings"] = {
        "characterStage": {
            "anchorX": 50,
            "anchorY": 60,
            "defaultHeightPercent": 120,
            "positions": {
                "left": 5,
                "centerLeft": 25,
                "center": 45,
                "centerRight": 65,
                "right": 95,
            },
        }
    }
    document["chapters"][0]["fragments"][0]["blocks"].insert(
        1,
        {
            "id": "legacy-character",
            "type": "showCharacter",
            "characterId": "character-one",
            "transform": {"x": 45, "y": 60},
        },
    )

    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)

    stage = normalized["settings"]["characterStage"]
    assert normalized["schemaVersion"] == "1.4"
    assert stage["anchor"] == "center"
    assert [(preset["x"], preset["y"]) for preset in stage["positionPresets"]] == [
        (12.0, 60.0),
        (5.0, 60.0),
        (25.0, 60.0),
        (45.0, 60.0),
        (65.0, 60.0),
        (95.0, 60.0),
        (88.0, 60.0),
    ]
    assert (
        normalized["chapters"][0]["fragments"][0]["blocks"][1]["transform"]["anchor"]
        == "bottomCenter"
    )


def test_galgame_story_v11_migrates_official_dialogue_blocks() -> None:
    document = playable_story()
    fragment = document["chapters"][0]["fragments"][0]
    fragment["blocks"] = [
        {
            "id": "legacy-speed",
            "type": "paragraphParams",
            "textSpeedMs": 25,
            "autoAdvanceMs": 1200,
            "skippable": False,
        },
        {"id": "instant-speed", "type": "paragraphParams", "textSpeedMs": 0},
        {"id": "player-wait", "type": "wait", "mode": "player", "durationMs": 900},
    ]

    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)

    assert normalized["schemaVersion"] == "1.4"
    assert normalized["chapters"][0]["fragments"][0]["blocks"] == [
        {"id": "legacy-speed", "type": "paragraphParams", "textSpeedCps": 40},
        {"id": "instant-speed", "type": "paragraphParams", "revealEffect": "instant"},
        {"id": "player-wait", "type": "wait", "mode": "player"},
    ]


def test_galgame_story_validates_rich_text_and_message_results() -> None:
    document = playable_story()
    document["variables"] = [
        {"id": "player-name", "name": "玩家名", "type": "string", "default": "真由理"},
        {"id": "accepted", "name": "确认结果", "type": "boolean", "default": False},
    ]
    fragment = document["chapters"][0]["fragments"][0]
    fragment["blocks"] = [
        {
            "id": "rich-dialogue",
            "type": "dialogue",
            "characterId": "character-one",
            "text": "旧摘要",
            "content": {
                "version": 1,
                "nodes": [
                    {"type": "text", "text": "欢迎，", "marks": {"bold": True}},
                    {"type": "variable", "variableId": "player-name"},
                    {"type": "wait", "mode": "duration", "durationMs": 500},
                ],
            },
        },
        {
            "id": "confirm",
            "type": "systemMessage",
            "mode": "confirm",
            "text": "是否继续？",
            "resultVariableId": "accepted",
        },
    ]

    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)
    dialogue = normalized["chapters"][0]["fragments"][0]["blocks"][0]
    assert dialogue["text"] == "欢迎，"
    assert dialogue["content"]["nodes"][0]["marks"]["bold"] is True

    invalid_result = deepcopy(document)
    invalid_result["chapters"][0]["fragments"][0]["blocks"][1]["resultVariableId"] = "player-name"
    with pytest.raises(ValueError, match="布尔变量"):
        GalgameStoryProject.model_validate(invalid_result)

    invalid_expression = deepcopy(document)
    invalid_expression["chapters"][0]["fragments"][0]["blocks"][0] = {
        "id": "bad-narration",
        "type": "narration",
        "content": {
            "version": 1,
            "nodes": [{"type": "expression", "expressionId": "smile"}],
        },
    }
    with pytest.raises(ValueError, match="只有对白"):
        GalgameStoryProject.model_validate(invalid_expression)

    empty_params = deepcopy(document)
    empty_params["chapters"][0]["fragments"][0]["blocks"] = [
        {"id": "empty-params", "type": "paragraphParams"}
    ]
    with pytest.raises(ValueError, match="至少需要修改一项"):
        GalgameStoryProject.model_validate(empty_params)


def test_galgame_story_reports_unavailable_soft_style_references() -> None:
    document = playable_story()
    document["presentation"] = {
        "paragraph": {"defaultStyleRef": {"source": "extension", "id": "missing-paragraph"}},
        "systemMessage": {"binding": {"source": "project", "id": "missing-message"}},
    }
    document["chapters"][0]["fragments"][0]["blocks"].insert(
        0,
        {
            "id": "extension-style",
            "type": "paragraphParams",
            "styleRef": {"source": "extension", "id": "cinematic"},
        },
    )
    normalized = GalgameStoryProject.model_validate(document)

    report = build_route_report("project", 7, normalized)
    warning_codes = {warning.code for warning in report.warnings}

    assert "unavailable_style_source" in warning_codes
    assert "unavailable_paragraph_style" in warning_codes


def test_galgame_timeline_accepts_parallel_point_events_and_rejects_conflicts() -> None:
    document = playable_story()
    document["characters"].append(
        {"id": "character-two", "name": "助手", "description": "协同行动"}
    )
    document["assets"] = [
        {
            "id": "bgm-one",
            "type": "audio",
            "role": "backgroundMusic",
            "label": "主题音乐",
            "fileId": "file-bgm",
            "status": "ready",
        },
        {
            "id": "sfx-one",
            "type": "audio",
            "role": "soundEffect",
            "label": "提示音",
            "fileId": "file-sfx",
            "status": "ready",
        },
    ]
    fragment = document["chapters"][0]["fragments"][0]
    fragment["timeline"] = {"durationMs": 3000}
    fragment["blocks"] = [
        {"id": "scene", "type": "scene", "sceneId": "scene-lab"},
        {
            "id": "show-one",
            "type": "showCharacter",
            "characterId": "character-one",
            "atMs": 0,
        },
        {
            "id": "show-two",
            "type": "showCharacter",
            "characterId": "character-two",
            "atMs": 0,
        },
        {
            "id": "stop-bgm",
            "type": "audio",
            "action": "stop",
            "channel": "bgm",
            "atMs": 0,
        },
        {
            "id": "play-bgm",
            "type": "audio",
            "action": "play",
            "channel": "bgm",
            "assetId": "bgm-one",
            "atMs": 0,
        },
        {
            "id": "sfx-a",
            "type": "audio",
            "action": "play",
            "channel": "sfx",
            "assetId": "sfx-one",
            "atMs": 0,
        },
        {
            "id": "sfx-b",
            "type": "audio",
            "action": "play",
            "channel": "sfx",
            "assetId": "sfx-one",
            "atMs": 0,
        },
        {
            "id": "line",
            "type": "dialogue",
            "characterId": "character-one",
            "text": "一起开始。",
            "startMs": 0,
            "endMs": 2500,
        },
        fragment["blocks"][-1],
    ]
    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)
    assert normalized["chapters"][0]["fragments"][0]["timeline"] == {"durationMs": 3000}
    assert normalized["chapters"][0]["fragments"][0]["blocks"][0].get("atMs") is None

    legacy_implicit = deepcopy(document)
    legacy_blocks = legacy_implicit["chapters"][0]["fragments"][0]["blocks"]
    del legacy_blocks[1]["atMs"]
    legacy_blocks.insert(
        2,
        {
            "id": "show-one-legacy-adjustment",
            "type": "showCharacter",
            "characterId": "character-one",
        },
    )
    GalgameStoryProject.model_validate(legacy_implicit)

    attached_to_first_dialogue = deepcopy(document)
    attached_blocks = attached_to_first_dialogue["chapters"][0]["fragments"][0]["blocks"]
    attached_blocks[-2]["startMs"] = 1000
    attached_blocks[-2]["endMs"] = 2500
    attached_blocks.insert(
        -2,
        {
            "id": "show-one-attached-to-dialogue",
            "type": "showCharacter",
            "characterId": "character-one",
        },
    )
    GalgameStoryProject.model_validate(attached_to_first_dialogue)

    conflict_cases = []
    duplicate_scene = deepcopy(document)
    duplicate_scene["chapters"][0]["fragments"][0]["blocks"].insert(
        1, {"id": "scene-two", "type": "scene", "sceneId": "scene-lab", "atMs": 0}
    )
    conflict_cases.append(duplicate_scene)

    duplicate_character = deepcopy(document)
    duplicate_character["chapters"][0]["fragments"][0]["blocks"].insert(
        2,
        {
            "id": "show-one-again",
            "type": "showCharacter",
            "characterId": "character-one",
            "atMs": 0,
        },
    )
    conflict_cases.append(duplicate_character)

    remove_all_conflict = deepcopy(document)
    remove_all_conflict["chapters"][0]["fragments"][0]["blocks"].insert(
        1, {"id": "remove-all", "type": "removeCharacter", "all": True, "atMs": 0}
    )
    conflict_cases.append(remove_all_conflict)

    duplicate_bgm = deepcopy(document)
    duplicate_bgm["chapters"][0]["fragments"][0]["blocks"].insert(
        6,
        {
            "id": "play-bgm-two",
            "type": "audio",
            "action": "play",
            "channel": "bgm",
            "assetId": "bgm-one",
            "atMs": 0,
        },
    )
    conflict_cases.append(duplicate_bgm)

    out_of_bounds = deepcopy(document)
    out_of_bounds["chapters"][0]["fragments"][0]["blocks"][1]["atMs"] = 3001
    conflict_cases.append(out_of_bounds)

    untimed_point = deepcopy(document)
    del untimed_point["chapters"][0]["fragments"][0]["timeline"]
    untimed_point["chapters"][0]["fragments"][0]["blocks"] = [
        {"id": "scene", "type": "scene", "sceneId": "scene-lab", "atMs": 0},
        untimed_point["chapters"][0]["fragments"][0]["blocks"][-1],
    ]
    conflict_cases.append(untimed_point)

    for invalid in conflict_cases:
        with pytest.raises(ValueError):
            GalgameStoryProject.model_validate(invalid)


def test_story_v2_typed_variables_attributes_and_builtin_block_families() -> None:
    document = playable_story()
    document["entryChapterId"] = "chapter-1"
    document["characterAttributeTemplates"] = [
        {
            "id": "trust",
            "name": "信任",
            "type": "number",
            "defaultValue": 0,
            "description": "线路判断用",
        }
    ]
    document["characters"][0]["attributes"] = {"trust": 2}
    document["variables"] = [
        {
            "id": "flag",
            "name": "已调查",
            "type": "boolean",
            "defaultValue": False,
            "persistence": "session",
            "description": "",
        }
    ]
    additions = [
        {"id": "paragraph", "type": "storyParagraph", "text": "段落"},
        {"id": "params", "type": "paragraphParams", "textSpeedMs": 20},
        {"id": "system", "type": "systemMessage", "text": "系统"},
        {"id": "comment", "type": "comment", "text": "注释"},
        {"id": "wait", "type": "wait", "durationMs": 500},
        {"id": "destroy", "type": "destroyScene"},
        {"id": "camera", "type": "camera", "effect": "shake"},
        {"id": "reset-camera", "type": "resetCamera"},
        {"id": "particle", "type": "particle", "preset": "snow"},
        {"id": "stage-animation", "type": "stageAnimation"},
        {"id": "floating", "type": "floatingText", "text": "线索 +1"},
        {"id": "curtain", "type": "curtain", "action": "show"},
        {"id": "sprite", "type": "animateSprite", "characterId": "character-one"},
        {"id": "autoplay", "type": "autoPlay", "enabled": True},
        {"id": "dialogue-style", "type": "switchDialogueStyle", "preset": "light"},
        {"id": "portrait-rule", "type": "portraitStyleRule", "mode": "stage"},
        {"id": "set-flag", "type": "setVariable", "variableId": "flag", "value": True},
        {
            "id": "if-flag",
            "type": "if",
            "condition": "flag == true",
            "thenFragmentId": "device-ending",
            "elseFragmentId": "clock-ending",
        },
        {"id": "call-device", "type": "callFragment", "targetFragmentId": "device-ending"},
    ]
    blocks = document["chapters"][0]["fragments"][0]["blocks"]
    blocks[2:2] = additions
    parsed = GalgameStoryProject.model_validate(document)
    assert parsed.entry_chapter_id == "chapter-1"
    assert parsed.characters[0].attributes == {"trust": 2}
    assert {block.type for block in parsed.chapters[0].fragments[0].blocks}.issuperset(
        {item["type"] for item in additions}
    )
    invalid_attribute = deepcopy(document)
    invalid_attribute["characters"][0]["attributes"]["trust"] = "高"
    with pytest.raises(ValueError, match="属性值与模板类型"):
        GalgameStoryProject.model_validate(invalid_attribute)

    invalid_variable = deepcopy(document)
    set_block = next(
        block
        for block in invalid_variable["chapters"][0]["fragments"][0]["blocks"]
        if block["id"] == "set-flag"
    )
    set_block["value"] = 1
    with pytest.raises(ValueError, match="变量赋值与声明类型"):
        GalgameStoryProject.model_validate(invalid_variable)


def test_galgame_curtain_modes_default_and_validate() -> None:
    document = playable_story()
    fragment = document["chapters"][0]["fragments"][0]
    fragment["blocks"] = [
        {"id": "legacy-curtain", "type": "curtain", "action": "show"},
        *[
            {
                "id": f"curtain-{mode}",
                "type": "curtain",
                "mode": mode,
                "action": "hide",
            }
            for mode in ("fullscreen", "letterbox", "pillarbox", "frame")
        ],
    ]

    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)
    curtains = normalized["chapters"][0]["fragments"][0]["blocks"]
    assert curtains[0]["mode"] == "fullscreen"
    assert [block["mode"] for block in curtains[1:]] == [
        "fullscreen",
        "letterbox",
        "pillarbox",
        "frame",
    ]

    invalid = deepcopy(document)
    invalid["chapters"][0]["fragments"][0]["blocks"][0]["mode"] = "circle"
    with pytest.raises(ValueError):
        GalgameStoryProject.model_validate(invalid)


def test_galgame_dialogue_supports_multiple_speakers_without_changing_legacy_blocks() -> None:
    story = playable_story()
    story["characters"].append({"id": "character-two", "name": "助手", "description": "同时回应"})
    dialogue = story["chapters"][0]["fragments"][0]["blocks"][1]
    dialogue["speakerIds"] = ["character-one", "character-two"]

    normalized = GalgameStoryProject.model_validate(story).model_dump(mode="json", by_alias=True)

    assert normalized["chapters"][0]["fragments"][0]["blocks"][1]["speakerIds"] == [
        "character-one",
        "character-two",
    ]
    legacy = playable_story()
    legacy_normalized = GalgameStoryProject.model_validate(legacy).model_dump(
        mode="json", by_alias=True
    )
    assert "speakerIds" not in legacy_normalized["chapters"][0]["fragments"][0]["blocks"][1]


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
