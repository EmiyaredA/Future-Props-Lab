import json

from scripts.galgame_performance_upgrade import (
    DEFAULT_ANNOTATION_PATH,
    DIALOGUE_BOX_OPACITY,
    DIALOGUE_EXPRESSION_CUES,
    EXPECTED_ANNOTATION_SHA256,
    EXPECTED_CROWD_NORMALIZED_LINES,
    LIP_SYNC_FPS,
    OPENING_DECLARATION_ID,
    OPENING_DECLARATION_TEXT,
    SCENE_BEATS,
    TRANSITION_CARD_BLOCKS,
    cast_member,
    enlarge_dialogue_text,
    fullscreen_cg_at,
    install_cgs,
    install_opening_declaration,
    install_special_character_expressions,
    install_transition_cards,
    remembered_cast_expression,
    sha256,
)
from scripts.galgame_runaway_cues import (
    CG_ASSETS,
    CG_EVENTS,
    SAFE_CLOSEUP_DIALOGUE_IDS,
    TOP_SAFE_PERCENT,
)

from app.galgame_workshop.video_compiler_support import actor_layout


def test_runaway_expression_cues_are_explicit_and_personality_checked() -> None:
    assert len(DIALOGUE_EXPRESSION_CUES) == 410
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0026"] == "e009-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0050"] == "e010-f000"
    assert DIALOGUE_EXPRESSION_CUES["runaway-annotated-line-0051"] == "e009-f000"
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
    assert len(CG_ASSETS) == 24
    assert len(CG_EVENTS) == 27
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
    assert len(document["cgs"]) == 24
    assert sum(block["type"] == "showCg" for block in blocks) == 27
    assert sum(block["type"] == "hideCg" for block in blocks) == 24
    q_shows = [
        block
        for block in blocks
        if block["type"] == "showCg" and block["id"].startswith("runaway-cg-show-q-")
    ]
    assert len(q_shows) == 3
    assert all(block["displayMode"] == "overlay" for block in q_shows)
    assert all(block["overlay"]["x"] == block["overlay"]["y"] == 50 for block in q_shows)
    assert all(abs((block["overlay"]["width"] / 100) ** 2 - 1 / 6) <= 0.01 for block in q_shows)
    phone_show = next(block for block in blocks if block["id"] == "runaway-cg-show-okabe-phone")
    phone_hide = next(block for block in blocks if block["id"] == "runaway-cg-hide-okabe-phone")
    assert phone_show["atMs"] == 68_051
    assert phone_show["overlay"]["width"] == 100
    assert phone_show["transition"]["durationMs"] == 220
    assert phone_hide["atMs"] == 78_422
    assert phone_hide["transition"]["durationMs"] == 250
    assert {
        block["id"] for block in blocks if block.get("id", "").startswith("runaway-phone-camera-")
    } == {"runaway-phone-camera-offscreen", "runaway-phone-camera-slide-in"}
    assert not any(block["type"] == "hideCg" and block["atMs"] >= 1_763_485 for block in blocks)


def test_opening_full_cast_cg_and_declaration_finish_before_voice() -> None:
    opening = next(event for event in CG_EVENTS if event["key"] == "full-cast-opening")
    assert (opening["startMs"], opening["endMs"]) == (0, 11_500)
    assert opening["endMs"] < 15_592
    document = {
        "chapters": [
            {
                "fragments": [
                    {
                        "timeline": {"durationMs": 1_780_344},
                        "blocks": [],
                    }
                ]
            }
        ]
    }
    install_opening_declaration(document)
    block = document["chapters"][0]["fragments"][0]["blocks"][0]
    assert block == {
        "id": OPENING_DECLARATION_ID,
        "type": "floatingText",
        "atMs": 500,
        "text": OPENING_DECLARATION_TEXT,
        "x": 50,
        "y": 50,
        "color": "#F4E7C5",
        "durationMs": 10_000,
    }


def test_v8_annotation_and_scene_timing_contract() -> None:
    assert DEFAULT_ANNOTATION_PATH.name == "广播剧.annotation (14).json"
    assert sha256(DEFAULT_ANNOTATION_PATH) == EXPECTED_ANNOTATION_SHA256
    assert LIP_SYNC_FPS == 5
    assert (372_443, "BG11A2") in SCENE_BEATS
    assert (387_752, "BG11A7") in SCENE_BEATS
    assert (456_433, "BG03A1") in SCENE_BEATS
    assert (1_627_170, "BG11A7") in SCENE_BEATS
    assert (1_677_392, "BG11_EMPTY") in SCENE_BEATS
    assert not any(at_ms in {653_198, 687_072, 1_604_000, 1_682_974} for at_ms, _ in SCENE_BEATS)

    annotation = json.loads(DEFAULT_ANNOTATION_PATH.read_text(encoding="utf-8"))
    assert len(annotation["segments"]) == 514
    assert sum(len(segment["speaker_ids"]) > 1 for segment in annotation["segments"]) == 12
    assert sum(len(segment["speaker_ids"]) > 3 for segment in annotation["segments"]) == (
        EXPECTED_CROWD_NORMALIZED_LINES
    )
    ensemble_id = next(
        speaker["id"] for speaker in annotation["speakers"] if speaker["name"] == "众人"
    )
    ensemble_segments = [
        segment for segment in annotation["segments"] if segment["speaker_id"] == ensemble_id
    ]
    assert len(ensemble_segments) == 2
    assert all(segment["speaker_ids"] == [ensemble_id] for segment in ensemble_segments)
    assert annotation["segments"][78]["localized_texts"][0]["text"] == (
        "你在说什么？我可是气量很大的男人！"
    )
    assert annotation["segments"][248]["localized_texts"][0]["text"] == "呐，篝的肚子饿了。"
    assert annotation["segments"][315]["localized_texts"][0]["text"] == "爸爸也最喜欢篝的哟！"


def test_v8_transition_cards_include_explanation_intertitle() -> None:
    document = {
        "chapters": [{"fragments": [{"timeline": {"durationMs": 1_780_344}, "blocks": []}]}]
    }
    install_transition_cards(document)
    blocks = document["chapters"][0]["fragments"][0]["blocks"]
    assert blocks == list(TRANSITION_CARD_BLOCKS)
    assert sum(block["type"] == "curtain" for block in blocks) == 6
    assert [block["text"] for block in blocks if block["type"] == "floatingText"] == [
        "众人前往屋顶......",
        "众人回到lab......",
        "玲羽和众人解释一番过后......",
    ]


def test_mayuri_gets_a_shy_expression_preset_with_lip_sync() -> None:
    document = {
        "characters": [
            {
                "id": "mayuri",
                "name": "椎名真由理",
                "expressions": [
                    {
                        "id": "e002-f000",
                        "label": "笑容",
                        "assetId": "closed",
                        "sequence": {
                            "frames": [
                                {"id": "old-closed", "assetId": "closed"},
                                {"id": "old-half", "assetId": "half"},
                                {"id": "old-open", "assetId": "open"},
                            ]
                        },
                    }
                ],
            }
        ]
    }
    install_special_character_expressions(document)
    shy = next(
        expression
        for expression in document["characters"][0]["expressions"]
        if expression["id"] == "e010-f000"
    )
    assert shy["label"] == "害羞"
    assert [frame["assetId"] for frame in shy["sequence"]["frames"]] == [
        "closed",
        "half",
        "open",
    ]


def test_v8_cg_timing_and_scene_consistency() -> None:
    events = {event["key"]: event for event in CG_EVENTS}
    assets = {asset["key"]: asset for asset in CG_ASSETS}
    assert (events["q-cough"]["startMs"], events["q-cough"]["endMs"]) == (
        20_100,
        22_351,
    )
    assert (events["okabe-rap"]["startMs"], events["okabe-rap"]["endMs"]) == (
        235_957,
        246_503,
    )
    assert events["kagari-imitation"]["endMs"] == 617_165
    assert events["suzuha-arrival"]["startMs"] == 660_594
    assert events["mother-identity"]["startMs"] == 788_490
    assert events["group-rebukes-kagari"]["startMs"] == 1_458_204
    assert (events["time-machine-leap"]["startMs"], events["time-machine-leap"]["endMs"]) == (
        1_666_293,
        1_677_392,
    )
    assert assets["kagari-imitation-v9"]["path"].name.endswith("v9.png")
    assert assets["suzuha-maho-v2"]["path"].name.endswith("v2.png")
    assert assets["harem-chaos-finale-v9"]["path"].name.endswith("v9.png")


def test_fullscreen_cg_detection_excludes_phone_overlay() -> None:
    assert fullscreen_cg_at(341_612)["key"] == "roundtable-1"
    assert fullscreen_cg_at(68_051) is None
    assert fullscreen_cg_at(364_948) is None


def test_pair_layout_uses_larger_medium_portraits() -> None:
    document = {
        "settings": {"characterStage": {"defaultHeightPercent": 100}},
        "characters": [
            {"id": "peer", "name": "椎名真由理", "portraitHeightPercent": 100},
            {"id": "suzuha", "name": "阿万音铃羽", "portraitHeightPercent": 100},
        ],
    }
    peer = cast_member(document, "peer", None, 0, 2, "line")
    suzuha = cast_member(document, "suzuha", None, 1, 2, "line")
    assert suzuha["transform"]["x"] - peer["transform"]["x"] == 56
    assert peer["distance"] == suzuha["distance"] == "medium"
    assert peer["transform"]["scale"] == suzuha["transform"]["scale"] == 0.9


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
    assert dialogue_box["backgroundColor"] == "#05070B"
    assert dialogue_box["backgroundOpacity"] == DIALOGUE_BOX_OPACITY
    assert dialogue_box["background"]["gradientTopOpacity"] == 1
    assert dialogue_box["background"]["gradientBottomOpacity"] == 1


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
