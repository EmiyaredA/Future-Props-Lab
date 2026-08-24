from scripts.galgame_performance_upgrade import (
    DIALOGUE_EXPRESSION_CUES,
    cast_member,
    enlarge_dialogue_text,
    install_cgs,
)
from scripts.galgame_runaway_cues import (
    CG_SPECS,
    SAFE_CLOSEUP_DIALOGUE_IDS,
    TOP_SAFE_PERCENT,
)

from app.galgame_workshop.video_compiler_support import actor_layout


def test_runaway_expression_cues_are_explicit_and_personality_checked() -> None:
    assert len(DIALOGUE_EXPRESSION_CUES) == 399
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
    effective_height = 120 * 1.28
    static_top = member["transform"]["y"] - effective_height
    assert static_top >= TOP_SAFE_PERCENT + 4
    assert static_top - 4 >= TOP_SAFE_PERCENT
    character = document["characters"][0]
    expression = character["expressions"][0]
    _x, y, scale, *_rest, height = actor_layout(document, character, member, expression)
    assert y / 10.8 - height * scale >= TOP_SAFE_PERCENT + 4


def test_unified_cg_manifest_installs_expected_events() -> None:
    assert len(CG_SPECS) == 13
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
    mapping = {"items": {spec["relative"]: {"assetId": f"file-{spec['key']}"} for spec in CG_SPECS}}
    install_cgs(document, mapping)
    blocks = document["chapters"][0]["fragments"][0]["blocks"]
    assert len(document["cgs"]) == 13
    assert sum(block["type"] == "showCg" for block in blocks) == 13
    assert sum(block["type"] == "hideCg" for block in blocks) == 11


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
    assert dialogue_box["body"] == {"fontSizePx": 34, "lineHeight": 1.5}
    assert dialogue_box["layout"] == {"heightPercent": 30}
