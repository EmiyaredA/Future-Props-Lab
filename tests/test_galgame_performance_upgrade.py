import json
from pathlib import Path

from scripts.galgame_performance_upgrade import (
    CURATED_CHARACTER_POSES,
    DEFAULT_ANNOTATION_PATH,
    DIALOGUE_BOX_OPACITY,
    DIALOGUE_EXPRESSION_CUES,
    ENDING_THANKS_ID,
    ENDING_THANKS_TEXT,
    EXPECTED_ANNOTATION_SHA256,
    EXPECTED_CROWD_NORMALIZED_LINES,
    HIDDEN_SCENE_SWITCH_MS,
    LIP_SYNC_FPS,
    OPENING_DECLARATION_ID,
    OPENING_DECLARATION_TEXT,
    SCENE_BEATS,
    TRANSITION_CARD_BLOCKS,
    cast_member,
    clear_adjacent_direct_portrait_overlaps,
    curated_portrait_entry,
    enlarge_dialogue_text,
    fullscreen_cg_at,
    install_cgs,
    install_curated_character_expressions,
    install_ending_thanks,
    install_opening_declaration,
    install_special_character_expressions,
    install_transition_cards,
    normalize_expression_labels,
    performance_expression_for_turn,
    performance_expression_id,
    remembered_cast_expression,
    scene_id_for_code,
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
    assert len(CG_ASSETS) == 25
    assert len(CG_EVENTS) == 28
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
    assert len(document["cgs"]) == 25
    assert sum(block["type"] == "showCg" for block in blocks) == 28
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
    ending = next(block for block in blocks if block["id"] == "runaway-cg-show-ending-blackboard")
    assert ending["atMs"] == 1_773_594
    assert ending["displayMode"] == "overlay"
    assert ending["overlay"]["width"] == 62


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


def test_ending_thanks_uses_opening_blackboard_timing() -> None:
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
    install_ending_thanks(document)
    block = document["chapters"][0]["fragments"][0]["blocks"][0]
    assert block == {
        "id": ENDING_THANKS_ID,
        "type": "floatingText",
        "atMs": 1_774_194,
        "text": ENDING_THANKS_TEXT,
        "x": 50,
        "y": 50,
        "color": "#F4E7C5",
        "durationMs": 6_150,
    }


def test_v8_annotation_and_scene_timing_contract() -> None:
    assert DEFAULT_ANNOTATION_PATH.name == "广播剧.annotation (14).json"
    assert sha256(DEFAULT_ANNOTATION_PATH) == EXPECTED_ANNOTATION_SHA256
    assert LIP_SYNC_FPS == 5
    assert (372_443, "BG11A2") in SCENE_BEATS
    assert (387_752, "BG11A7") in SCENE_BEATS
    assert (456_433, "SG_BG01A") in SCENE_BEATS
    assert (686_472, "SG_BG02A2") in SCENE_BEATS
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


def test_lab_scene_schedule_uses_two_main_compositions_with_time_progression() -> None:
    lab_beats = [(at_ms, code) for at_ms, code in SCENE_BEATS if code.startswith("SG_")]
    assert lab_beats == [
        (0, "SG_BG01A"),
        (151_754, "SG_BG02A2"),
        (456_433, "SG_BG01A"),
        (686_472, "SG_BG02A2"),
        (970_000, "SG_BG01E"),
        (1_188_000, "SG_BG02E2"),
        (1_300_000, "SG_BG01N"),
        (1_364_000, "SG_BG02N2"),
    ]
    assert all(code.startswith(("SG_BG01", "SG_BG02")) for _at_ms, code in lab_beats)
    assert not any(code.startswith("BG03") for _at_ms, code in SCENE_BEATS)
    assert HIDDEN_SCENE_SWITCH_MS == {372_443, 456_433, 686_472}
    assert scene_id_for_code("SG_BG01A") == "sg-bg01a"
    assert scene_id_for_code("BG11A7") == "sg0-bg11a7"


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


def test_curated_expressions_add_pose_variety_and_private_clothes() -> None:
    document = {
        "assets": [],
        "characters": [
            {"id": "kurisu-makise", "name": "牧濑红莉栖", "expressions": []},
            {
                "id": "mayuri",
                "name": "椎名真由理",
                "expressions": [{"id": "e002-f000", "label": "笑容", "assetId": "old-mayuri"}],
            },
            {"id": "daru", "name": "桥田至", "expressions": []},
            {
                "id": "faris",
                "name": "菲莉丝·喵喵",
                "expressions": [
                    {"id": f"e{index:03d}-f000", "label": "旧女仆装"} for index in range(1, 5)
                ],
            },
            {
                "id": "luka",
                "name": "漆原琉华",
                "expressions": [
                    {"id": f"e{index:03d}-f000", "label": "旧巫女服"} for index in range(1, 7)
                ],
            },
            {"id": "moeka", "name": "桐生萌郁", "expressions": []},
            {
                "id": "suzuha",
                "name": "阿万音铃羽",
                "expressions": [
                    {"id": f"e{index:03d}-f000", "label": "旧铃羽表情"} for index in range(1, 7)
                ],
            },
            {
                "id": "kagari",
                "name": "冈部篝",
                "expressions": [
                    {"id": f"e{index:03d}-f000", "label": "旧篝表情"} for index in range(1, 8)
                ],
            },
            {
                "id": "maho",
                "name": "比屋定真帆",
                "expressions": [
                    {"id": f"e{index:03d}-f000", "label": "旧真帆表情"} for index in range(1, 13)
                ],
            },
            {
                "id": "yuugo",
                "name": "天王寺裕吾",
                "expressions": [
                    {"id": f"e{index:03d}-f000", "label": "旧天王寺表情"} for index in range(1, 4)
                ],
            },
        ],
    }
    source_root = Path("/original-sg0")
    mapping = {"items": {}}
    for character_spec in CURATED_CHARACTER_POSES:
        for pose_spec in character_spec["poses"]:
            for variant in range(1, len(pose_spec["labels"]) + 1):
                for mouth in range(3):
                    _path, relative = curated_portrait_entry(
                        source_root,
                        character_spec["sourceDirectory"],
                        pose_spec["code"],
                        variant,
                        mouth,
                    )
                    mapping["items"][relative] = {"assetId": f"file-{relative}"}

    install_curated_character_expressions(document, mapping, source_root)
    install_special_character_expressions(document)
    normalize_expression_labels(document)
    characters = {character["id"]: character for character in document["characters"]}

    faris = characters["faris"]
    assert len(faris["expressions"]) == 12
    assert next(item for item in faris["expressions"] if item["id"] == "e001-f000")[
        "assetId"
    ].startswith("sg0-fei-dla-")
    assert not any(item.get("label") == "旧女仆装" for item in faris["expressions"])

    luka = characters["luka"]
    assert len(luka["expressions"]) == 11
    assert next(item for item in luka["expressions"] if item["id"] == "e001-f000")[
        "assetId"
    ].startswith("sg0-ruk-cla-")
    assert not any(item.get("label") == "旧巫女服" for item in luka["expressions"])

    mayuri = characters["mayuri"]
    shy = next(item for item in mayuri["expressions"] if item["id"] == "e010-f000")
    assert shy["assetId"].startswith("sg0-may-alc-e003-")
    assert shy["label"] == "双手交握·害羞"
    assert len(characters["kurisu-makise"]["expressions"]) == 15
    assert next(
        item
        for item in characters["kurisu-makise"]["expressions"]
        if item["id"] == "crs-alc-e006-f000"
    )["assetId"].startswith("sg0-crs-alc-")
    assert len(characters["daru"]["expressions"]) == 6
    assert len(characters["moeka"]["expressions"]) == 5
    assert len(characters["suzuha"]["expressions"]) == 21
    assert len(characters["kagari"]["expressions"]) == 12
    assert (
        next(item for item in characters["kagari"]["expressions"] if item["id"] == "e007-f000")[
            "label"
        ]
        == "水手服站姿·闭眼微笑"
    )
    assert len(characters["maho"]["expressions"]) == 21
    assert len(characters["yuugo"]["expressions"]) == 6


def test_curated_expression_overrides_are_used_for_performance() -> None:
    assert performance_expression_id("kurisu-makise", "e008-f000") == ("crs-alb-e008-f000")
    assert performance_expression_id("kurisu-makise", "e009-f000") == ("crs-alc-e006-f000")
    assert performance_expression_id("mayuri", "e003-f000") == "may-alc-e001-f000"
    assert performance_expression_id("faris", "e003-f000") == "fei-dlc-e003-f000"
    assert performance_expression_id("luka", "e005-f000") == "ruk-clb-e005-f000"
    assert performance_expression_id("suzuha", "e003-f000") == "suz-hme-e003-f000"
    assert performance_expression_id("kagari", "e005-f000") == "kag-alb-e003-f000"
    assert performance_expression_id("maho", "e009-f000") == "mah-alb-e006-f000"
    assert performance_expression_id("yuugo", "e002-f000") == "ten-bla-e002-f000"
    assert performance_expression_id("okabe-rintarou", "e003-f000") == "e003-f000"


def test_performance_pose_changes_without_changing_emotion() -> None:
    assert [
        performance_expression_for_turn("kurisu-makise", "e005-f000", turn) for turn in range(6)
    ] == [
        "crs-alc-e004-f000",
        "crs-alc-e004-f000",
        "crs-alb-e005-f000",
        "crs-alb-e005-f000",
        "e005-f000",
        "e005-f000",
    ]
    assert performance_expression_for_turn("kagari", "e004-f000", 0) == "e004-f000"
    assert performance_expression_for_turn("kagari", "e004-f000", 2) == "kag-alb-e004-f000"
    assert performance_expression_for_turn("okabe-rintarou", "e003-f000", 99) == ("e003-f000")


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


def test_adjacent_direct_portraits_do_not_linger_in_the_same_slot() -> None:
    dialogues = [
        {
            "id": "kurisu-line",
            "characterId": "kurisu",
            "portrait": {
                "visible": True,
                "positionId": "performance-center",
                "keepAfter": True,
            },
        },
        {
            "id": "kagari-line",
            "characterId": "kagari",
            "portrait": {
                "visible": True,
                "positionId": "performance-center",
                "keepAfter": True,
            },
        },
    ]
    assert clear_adjacent_direct_portrait_overlaps(dialogues) == ["kurisu-line"]
    assert dialogues[0]["portrait"]["keepAfter"] is False
    assert dialogues[1]["portrait"]["keepAfter"] is True
