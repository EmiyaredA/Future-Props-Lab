from copy import deepcopy

import httpx
import pytest

from app.main import app
from studio.apps.galgame_workshop.schemas import GalgameStoryProject
from studio.apps.galgame_workshop.story.story import build_route_report


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


def test_galgame_dialogue_box_classic_gradient_schema_and_legacy_defaults() -> None:
    legacy = GalgameStoryProject.model_validate(playable_story()).model_dump(
        mode="json", by_alias=True
    )
    legacy_style = legacy["presentation"]["dialogueBox"]
    assert legacy_style["layout"]["mode"] == "boxed"
    assert legacy_style["background"]["mode"] == "solid"
    assert legacy_style["speakerName"]["placement"] == "topLeft"

    document = playable_story()
    document.setdefault("presentation", {})["dialogueBox"] = {
        "preset": "classicGradient",
        "backgroundColor": "#05070B",
        "textColor": "#F7F7F5",
        "nameColor": "#F3F1EB",
        "backgroundOpacity": 0.94,
        "borderRadius": 0,
        "fontScale": 1,
        "layout": {
            "mode": "bottomOverlay",
            "widthPercent": 100,
            "heightPercent": 30,
            "bottomOffsetPercent": 0,
            "contentInsetXPercent": 11,
            "contentInsetTopPercent": 12,
            "contentInsetBottomPercent": 6,
        },
        "background": {
            "mode": "verticalGradient",
            "gradientTopOpacity": 0.18,
            "gradientBottomOpacity": 0.94,
            "topRule": "double",
            "topRuleColor": "#E6E4DD",
            "topRuleOpacity": 0.24,
        },
        "body": {
            "fontSizePx": 30,
            "lineHeight": 1.55,
            "align": "left",
            "maxWidthPercent": 78,
        },
        "speakerName": {
            "placement": "bottomCenter",
            "fontSizePx": 22,
            "decoration": "sideLines",
        },
        "advanceIndicator": {
            "visible": True,
            "position": "bottomLeft",
            "style": "compact",
            "showInExport": True,
        },
    }
    normalized = GalgameStoryProject.model_validate(document).model_dump(mode="json", by_alias=True)
    assert normalized["presentation"]["dialogueBox"]["preset"] == "classicGradient"
    assert normalized["presentation"]["dialogueBox"]["body"]["align"] == "left"

    invalid = deepcopy(document)
    invalid["presentation"]["dialogueBox"]["body"]["fontSizePx"] = 120
    with pytest.raises(ValueError):
        GalgameStoryProject.model_validate(invalid)


def test_galgame_stage_cast_and_sprite_motion_contracts() -> None:
    document = playable_story()
    document["characters"].extend(
        [
            {"id": "character-two", "name": "角色2"},
            *({"id": f"character-{index}", "name": f"角色{index}"} for index in range(3, 9)),
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
                *({"characterId": f"character-{index}"} for index in range(3, 9)),
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
    assert normalized["chapters"][0]["fragments"][0]["blocks"][0]["transition"] == {
        "durationMs": 0,
        "fade": False,
    }
    cast = normalized["chapters"][0]["fragments"][0]["blocks"][1]
    motion = normalized["chapters"][0]["fragments"][0]["blocks"][2]
    assert len(cast["members"]) == 8
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
    overcrowded["characters"].append({"id": "character-nine", "name": "第九人"})
    overcrowded["chapters"][0]["fragments"][0]["blocks"][1]["members"].append(
        {"characterId": "character-nine"}
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

    bottom_anchored = deepcopy(document)
    bottom_anchored["settings"] = {
        "characterStage": {
            "anchor": "bottomCenter",
            "defaultPositionId": "position-center",
            "defaultHeightPercent": 100,
            "positionPresets": [{**preset, "y": 100} for preset in default_position_presets()],
        }
    }
    parsed_bottom_anchored = GalgameStoryProject.model_validate(bottom_anchored).model_dump(
        mode="json", by_alias=True
    )
    assert parsed_bottom_anchored["settings"]["characterStage"]["anchor"] == "bottomCenter"
    assert {
        preset["y"]
        for preset in parsed_bottom_anchored["settings"]["characterStage"]["positionPresets"]
    } == {100.0}

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
