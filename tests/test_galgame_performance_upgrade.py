from scripts.galgame_performance_upgrade import (
    DIALOGUE_EXPRESSION_CUES,
    cast_member,
    enlarge_dialogue_text,
    install_cgs,
    remembered_cast_expression,
)
from scripts.galgame_runaway_cues import (
    CG_ASSETS,
    CG_EVENTS,
    SAFE_CLOSEUP_DIALOGUE_IDS,
    TOP_SAFE_PERCENT,
)

from app.galgame_workshop.video_compiler_support import actor_layout


def test_runaway_expression_cues_are_explicit_and_personality_checked() -> None:
    assert len(DIALOGUE_EXPRESSION_CUES) == 409
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0176"] == "e005-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0184"] == "e004-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0186"] == "e005-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0197"] == "e009-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0353"] == "e002-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0510"] == "e008-f000"


def test_curated_closeup_keeps_motion_safe_headroom() -> None:
    dialogue_id = next(iter(SAFE_CLOSEUP_DIALOGUE_IDS))
    document = {
        "settings": {"characterStage": {"defaultHeightPercent": 100}},
        "characters": [
            {
                "id": "hero",
                "portraitHeightPercent": 100,
                "expressions": [{"id": "emotion", "heightPercent": 120}],
            }
        ],
    }
    member = cast_member(document, "hero", "emotion", 0, 1, dialogue_id)
    assert member["distance"] == "near"
    assert member["positionId"] == "performance-center"
    effective_height = 120 * 1.28 * member["transform"]["scale"]
    static_top = member["transform"]["y"] - effective_height
    assert static_top >= TOP_SAFE_PERCENT + 4
    assert static_top - 4 >= TOP_SAFE_PERCENT
    assert member["transform"]["y"] == 100
    character = document["characters"][0]
    expression = character["expressions"][0]
    _x, y, scale, *_rest, height = actor_layout(document, character, member, expression)
    assert y / 10.8 - height * scale >= TOP_SAFE_PERCENT + 4
    assert y / 10.8 == 100


def test_unified_cg_manifest_installs_expected_events() -> None:
    assert len(CG_ASSETS) == 20
    assert len(CG_EVENTS) == 23
    document = {
        "assets": [],
        "cgs": [],
        "chapters": [
            {
                "fragments": [
                    {
                        "timeline": {"durationMs": 1_780_344},
                        "blocks": [],
                    }
                ]
            }
        ],
    }
    mapping = {
        "items": {spec["relative"]: {"assetId": f"file-{spec['key']}"} for spec in CG_ASSETS}
    }
    install_cgs(document, mapping)
    blocks = document["chapters"][0]["fragments"][0]["blocks"]
    assert len(document["cgs"]) == 20
    assert sum(block["type"] == "showCg" for block in blocks) == 23
    assert sum(block["type"] == "hideCg" for block in blocks) == 20
    q_shows = [
        block
        for block in blocks
        if block["type"] == "showCg" and block["id"].startswith("runaway-cg-show-q-")
    ]
    assert len(q_shows) == 3
    assert all(block["displayMode"] == "overlay" for block in q_shows)
    assert all(block["overlay"]["x"] == block["overlay"]["y"] == 50 for block in q_shows)
    assert all(abs((block["overlay"]["width"] / 100) ** 2 - 1 / 6) <= 0.01 for block in q_shows)
    assert not any(block["type"] == "hideCg" and block["atMs"] >= 1_763_485 for block in blocks)


def test_dialogue_text_is_enlarged_without_changing_layout() -> None:
    document = {
        "presentation": {
            "dialogueBox": {
                "layout": {"heightPercent": 30},
                "body": {"fontSizePx": 30, "lineHeight": 1.55},
            }
        }
    }
    enlarge_dialogue_text(document)
    dialogue_box = document["presentation"]["dialogueBox"]
    assert dialogue_box["body"] == {
        "fontSizePx": 34,
        "lineHeight": 1.5,
        "maxWidthPercent": 100,
    }
    assert dialogue_box["layout"] == {"heightPercent": 30}


def test_shadowed_cast_member_keeps_previous_expression() -> None:
    characters = {
        "speaker": {"defaultExpressionId": "speaker-default"},
        "shadowed": {"defaultExpressionId": "shadowed-default"},
    }
    dialogue = {"characterId": "speaker", "expressionId": "speaker-angry"}
    remembered = {"speaker": "speaker-calm", "shadowed": "shadowed-worried"}
    assert (
        remembered_cast_expression("speaker", dialogue, characters, remembered) == "speaker-angry"
    )
    assert (
        remembered_cast_expression("shadowed", dialogue, characters, remembered)
        == "shadowed-worried"
    )


def test_shadowed_cast_member_uses_default_before_first_expression() -> None:
    characters = {"shadowed": {"defaultExpressionId": "shadowed-default"}}
    assert (
        remembered_cast_expression(
            "shadowed",
            {"characterId": "speaker", "expressionId": "speaker-calm"},
            characters,
            {},
        )
        == "shadowed-default"
    )
