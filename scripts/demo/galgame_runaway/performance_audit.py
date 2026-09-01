# ruff: noqa: F403, F405, I001

from __future__ import annotations

from scripts.demo.galgame_runaway.performance_upgrade import *  # noqa: F403


def audit_document(
    document: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_audit: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fragment = target_fragment(document)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    first_person_id = first_person_okabe(document)["id"]
    cast_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "setStageCast"
    ]
    lip_sync_fps = [
        expression["sequence"]["fps"]
        for character in document.get("characters", [])
        for expression in character.get("expressions", [])
        if expression.get("sequence", {}).get("playbackMode") == "lipSync"
    ]
    scene_blocks = [block for block in fragment.get("blocks", []) if block.get("type") == "scene"]
    camera_blocks = [block for block in fragment.get("blocks", []) if block.get("type") == "camera"]
    curtain_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "curtain"
    ]
    stage_events = sorted(
        [
            block
            for block in fragment.get("blocks", [])
            if block.get("type") in {"scene", "setStageCast"} and block.get("atMs") is not None
        ],
        key=lambda block: (block["atMs"], 0 if block["type"] == "scene" else 1),
    )

    def cast_at(milliseconds: int) -> list[dict[str, Any]]:
        members: list[dict[str, Any]] = []
        for event in stage_events:
            if event["atMs"] > milliseconds:
                break
            if event["type"] == "scene" and event.get("clearCharacters", True):
                members = []
            elif event["type"] == "setStageCast":
                members = event.get("members", [])
        return members

    silent_gaps = [
        (dialogues[index]["endMs"], dialogues[index + 1]["startMs"])
        for index in range(len(dialogues) - 1)
        if dialogues[index + 1]["startMs"] - dialogues[index]["endMs"] > 80
    ]
    nonempty_silent_gaps = [
        (start, end) for start, end in silent_gaps if cast_at(start + (end - start) // 2)
    ]
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    visible_character_ids = {
        character_id
        for character_id, character in character_by_id.items()
        if character.get("expressions") and character_id != first_person_id
    }
    expression_dialogues = [
        dialogue for dialogue in dialogues if dialogue.get("characterId") in visible_character_ids
    ]
    group_dialogues = [
        dialogue for dialogue in dialogues if dialogue["id"] in GROUP_CG_DIALOGUE_IDS
    ]
    q_overlay_dialogues = [
        dialogue for dialogue in dialogues if dialogue["id"] in Q_OVERLAY_DIALOGUE_IDS
    ]
    visually_hidden_dialogue_ids = GROUP_CG_DIALOGUE_IDS | Q_OVERLAY_DIALOGUE_IDS
    visible_dialogues = [
        dialogue
        for dialogue in expression_dialogues
        if dialogue["id"] not in visually_hidden_dialogue_ids
    ]
    hidden_dialogues = [
        dialogue
        for dialogue in dialogues
        if dialogue.get("characterId") not in visible_character_ids
        and dialogue["id"] not in visually_hidden_dialogue_ids
    ]
    expression_ids = {
        character_id: {expression["id"] for expression in character.get("expressions", [])}
        for character_id, character in character_by_id.items()
    }
    expression_label_mismatches = [
        {
            "characterId": character_id,
            "expressionId": expression_id,
            "expected": expected,
            "actual": next(
                (
                    expression.get("label")
                    for expression in character_by_id.get(character_id, {}).get("expressions", [])
                    if expression.get("id") == expression_id
                ),
                None,
            ),
        }
        for character_id, labels in EXPRESSION_LABEL_OVERRIDES.items()
        for expression_id, expected in labels.items()
        if next(
            (
                expression.get("label")
                for expression in character_by_id.get(character_id, {}).get("expressions", [])
                if expression.get("id") == expression_id
            ),
            None,
        )
        != expected
    ]
    ambiguous_expression_labels = [
        {
            "characterId": character_id,
            "expressionId": expression.get("id"),
            "label": expression.get("label"),
        }
        for character_id, character in character_by_id.items()
        for expression in character.get("expressions", [])
        if "·" not in str(expression.get("label") or "")
    ]
    invalid_expression_dialogues: list[str] = []
    speaking_turn_by_character: dict[str, int] = {}
    for dialogue in expression_dialogues:
        character_id = dialogue["characterId"]
        speaking_turn = speaking_turn_by_character.get(character_id, 0)
        expected_expression_id = performance_expression_for_turn(
            character_id,
            DIALOGUE_EXPRESSION_CUES.get(dialogue["id"]),
            speaking_turn,
        )
        speaking_turn_by_character[character_id] = speaking_turn + 1
        if dialogue.get("expressionId") not in expression_ids.get(
            character_id, set()
        ) or expected_expression_id != dialogue.get("expressionId"):
            invalid_expression_dialogues.append(dialogue["id"])
    pose_variety_by_character = {
        character_id: sorted(
            {
                "primary"
                if expression_id.startswith(
                    (
                        "e",
                        "confident",
                        "maniac",
                        "annoyed",
                        "surprised",
                        "serious",
                        "concerned",
                        "closed",
                    )
                )
                else expression_id.rsplit("-e", 1)[0]
                for expression_id in (
                    dialogue.get("expressionId", "")
                    for dialogue in expression_dialogues
                    if dialogue["characterId"] == character_id
                )
                if expression_id
            }
        )
        for character_id in PERFORMANCE_POSE_CANDIDATES
    }
    missing_pose_variety = [
        character_id
        for character_id, pose_families in pose_variety_by_character.items()
        if len(pose_families) < 2
    ]
    cast_block_by_id = {block["id"]: block for block in cast_blocks}
    stage_managed_dialogue_ids = {
        dialogues[int(block_id.rsplit("-", 1)[1])]["id"]
        for block_id in cast_block_by_id
        if block_id.startswith("perf-cast-") and block_id != "perf-cast-final-clear"
    }
    direct_visible_dialogues = [
        dialogue
        for dialogue in visible_dialogues
        if dialogue["id"] not in stage_managed_dialogue_ids
    ]
    visible_hidden_portraits = [
        dialogue["id"]
        for dialogue in direct_visible_dialogues
        if not dialogue.get("portrait", {}).get("visible")
    ]
    stage_managed_visible_portraits = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue["id"] in stage_managed_dialogue_ids
        and dialogue.get("portrait", {}).get("visible")
    ]
    hidden_visible_portraits = [
        dialogue["id"]
        for dialogue in hidden_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    group_visible_portraits = [
        dialogue["id"]
        for dialogue in group_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    q_overlay_visible_portraits = [
        dialogue["id"]
        for dialogue in q_overlay_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    duplicate_portrait_layer_dialogues = []
    for cue_index, dialogue in enumerate(dialogues):
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if (
            block
            and dialogue.get("portrait", {}).get("visible")
            and any(
                member.get("characterId") == dialogue.get("characterId")
                for member in block.get("members", [])
            )
        ):
            duplicate_portrait_layer_dialogues.append(dialogue["id"])
    stale_cast_expressions: list[dict[str, Any]] = []
    last_expression_by_character: dict[str, str] = {}
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    for cue_index, dialogue in enumerate(dialogues):
        character_id = dialogue.get("characterId")
        if character_id in visible_character_ids and dialogue.get("expressionId"):
            last_expression_by_character[character_id] = dialogue["expressionId"]
        for character_name, expression_id in CAST_EXPRESSION_OVERRIDES.get(dialogue["id"], ()):
            override_character_id = find_character(document, (character_name,))["id"]
            last_expression_by_character[override_character_id] = performance_expression_id(
                override_character_id, expression_id
            )
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if not block:
            continue
        for member in block.get("members", []):
            expected = last_expression_by_character.get(
                member["characterId"]
            ) or character_by_id.get(member["characterId"], {}).get("defaultExpressionId")
            if member.get("expressionId") != expected:
                stale_cast_expressions.append(
                    {
                        "owner": block["id"],
                        "characterId": member["characterId"],
                        "expected": expected,
                        "actual": member.get("expressionId"),
                    }
                )

    unsafe_frames: list[dict[str, Any]] = []
    floating_frames: list[dict[str, Any]] = []

    def check_safe_frame(
        *,
        owner: str,
        character_id: str,
        expression_id: str | None,
        distance: str,
        transform: dict[str, Any],
    ) -> None:
        height = portrait_height_percent(document, character_id, expression_id)
        effective_height = (
            height * DISTANCE_SCALES.get(distance, 1.0) * float(transform.get("scale", 1))
        )
        top = float(transform.get("y", 100)) - effective_height
        if top < TOP_SAFE_PERCENT:
            unsafe_frames.append({"owner": owner, "topPercent": round(top, 3)})
        if (
            transform.get("anchor", "bottomCenter") == "bottomCenter"
            and float(transform.get("y", 100)) != STAGE_BOTTOM_PERCENT
        ):
            floating_frames.append(
                {"owner": owner, "bottomPercent": float(transform.get("y", 100))}
            )

    for block in cast_blocks:
        for member in block.get("members", []):
            check_safe_frame(
                owner=block["id"],
                character_id=member["characterId"],
                expression_id=member.get("expressionId"),
                distance=member["distance"],
                transform=member["transform"],
            )
    for dialogue in direct_visible_dialogues:
        portrait = dialogue["portrait"]
        inherited = next(
            (
                member
                for member in cast_at(dialogue["startMs"])
                if member.get("characterId") == dialogue["characterId"]
            ),
            {},
        )
        check_safe_frame(
            owner=dialogue["id"],
            character_id=dialogue["characterId"],
            expression_id=dialogue.get("expressionId"),
            distance=portrait.get("distance") or inherited.get("distance") or "medium",
            transform=portrait.get("transform") or inherited.get("transform") or {},
        )

    near_dialogue_ids = set()
    for cue_index, dialogue in enumerate(dialogues):
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if block and any(member.get("distance") == "near" for member in block.get("members", [])):
            near_dialogue_ids.add(dialogue["id"])
        elif dialogue.get("portrait", {}).get("distance") == "near":
            near_dialogue_ids.add(dialogue["id"])
    show_cg_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "showCg"
    ]
    hide_cg_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "hideCg"
    ]
    opening_declaration_blocks = [
        block for block in fragment.get("blocks", []) if block.get("id") == OPENING_DECLARATION_ID
    ]
    ending_thanks_blocks = [
        block for block in fragment.get("blocks", []) if block.get("id") == ENDING_THANKS_ID
    ]
    opening_event = next(
        (event for event in CG_EVENTS if event["key"] == "full-cast-opening"), None
    )
    first_dialogue_start_ms = min(dialogue["startMs"] for dialogue in dialogues)
    managed_cg_ids = {spec["cgId"] for spec in CG_ASSETS}
    cg_event_ids = [block["id"] for block in [*show_cg_blocks, *hide_cg_blocks]]
    cg_intervals = sorted(
        (event["startMs"], event["endMs"], event["key"])
        for event in CG_EVENTS
        if event["endMs"] is not None and not event["key"].startswith("q-")
    )
    cg_overlaps = [
        (left[2], right[2])
        for left, right in zip(cg_intervals, cg_intervals[1:], strict=False)
        if left[1] is not None and left[1] > right[0]
    ]
    scene_beats = [(block["atMs"], block["sceneId"]) for block in scene_blocks]
    expected_scene_beats = [
        (at_ms, scene_id_for_code(scene_code)) for at_ms, scene_code in SCENE_BEATS
    ]
    scene_events_inside_cgs = [
        {
            "sceneBlockId": block["id"],
            "atMs": block["atMs"],
            "cg": spec["key"],
        }
        for block in scene_blocks
        for spec in CG_EVENTS
        if spec["endMs"] is not None and spec["startMs"] < block["atMs"] < spec["endMs"]
    ]
    character_fades = [
        block["id"]
        for block in fragment.get("blocks", [])
        if block.get("type") == "setStageCast"
        and (
            (block.get("exitTransition") or {}).get("fade")
            or any(
                (member.get("transition") or {}).get("fade") for member in block.get("members", [])
            )
        )
    ] + [
        dialogue["id"]
        for dialogue in dialogues
        if (dialogue.get("portrait", {}).get("transition") or {}).get("fade")
    ]
    q_events = [event for event in CG_EVENTS if event["key"].startswith("q-")]
    group_cg_coverage = {
        dialogue["id"]: any(
            event["startMs"] <= dialogue["startMs"]
            and (event["endMs"] is None or event["endMs"] >= dialogue["endMs"])
            for event in CG_EVENTS
        )
        for dialogue in group_dialogues
    }
    final_cg_blocks = [
        block for block in show_cg_blocks if block["id"] == "runaway-cg-show-harem-chaos-finale"
    ]
    ending_blackboard_blocks = [
        block for block in show_cg_blocks if block["id"] == "runaway-cg-show-ending-blackboard"
    ]
    final_cg_hands_off_to_thanks = (
        len(final_cg_blocks) == 1
        and final_cg_blocks[0]["atMs"] == 1_763_485
        and len(ending_blackboard_blocks) == 1
        and ending_blackboard_blocks[0]["atMs"] == 1_773_594
        and not any(block["atMs"] >= 1_763_485 for block in hide_cg_blocks)
    )
    fullscreen_events = [event for event in CG_EVENTS if event["displayMode"] == "fullscreen"]
    dialogue_start_ms = {dialogue["startMs"] for dialogue in dialogues}
    fullscreen_timing_errors = [
        event["key"]
        for event in fullscreen_events
        if event["startMs"] != 0
        and event["startMs"] not in dialogue_start_ms
        and not any(
            previous.get("endMs") is not None and event["startMs"] == previous["endMs"] + 1
            for previous in fullscreen_events
        )
    ]
    cg_entry_stage_flash_risks = [
        block["id"]
        for block in cast_blocks
        if any(
            event["startMs"] > 0 and block.get("atMs") == event["startMs"]
            for event in fullscreen_events
        )
    ]
    cg_entry_portrait_flash_risks = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("portrait", {}).get("visible")
        and any(
            event["startMs"] > 0 and dialogue["startMs"] == event["startMs"]
            for event in fullscreen_events
        )
    ]
    fullscreen_visible_portraits = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("portrait", {}).get("visible")
        and fullscreen_cg_at(dialogue["startMs"]) is not None
    ]
    suzuha = find_character(document, ("铃羽", "鈴羽", "玲羽", "Suzuha"))
    suzuha_asset_ids = {
        expression.get("assetId", "") for expression in suzuha.get("expressions", [])
    }
    suzuha_crop_dimensions = {
        png_dimensions(suzuha_crop_entry(pose, variant, mouth)[0])
        for pose, variant in SUZUHA_VARIANTS.values()
        for mouth in range(3)
    }
    curated_character_checks: dict[str, dict[str, Any]] = {}
    for character_spec in CURATED_CHARACTER_POSES:
        character = find_character(document, character_spec["characterNames"])
        expressions = {
            expression["id"]: expression for expression in character.get("expressions", [])
        }
        expected_ids: set[str] = set()
        expected_asset_prefixes: dict[str, str] = {}
        replace_primary = bool(character_spec.get("replacePrimary"))
        primary_pose = character_spec["poses"][0]["code"]
        for pose_spec in character_spec["poses"]:
            pose = pose_spec["code"]
            asset_prefix = f"sg0-{pose.lower().replace('_', '-')}-"
            for variant in range(1, len(pose_spec["labels"]) + 1):
                expression_id = (
                    f"e{variant:03d}-f000"
                    if replace_primary and pose == primary_pose
                    else curated_expression_id(pose, variant)
                )
                expected_ids.add(expression_id)
                expected_asset_prefixes[expression_id] = asset_prefix
        missing_ids = sorted(expected_ids - expressions.keys())
        wrong_assets: list[str] = []
        invalid_sequences: list[str] = []
        for expression_id, expected_prefix in expected_asset_prefixes.items():
            expression = expressions.get(expression_id)
            if not expression:
                continue
            if not str(expression.get("assetId", "")).startswith(expected_prefix):
                wrong_assets.append(expression_id)
            sequence = expression.get("sequence") or {}
            frames = sequence.get("frames") or []
            if (
                sequence.get("playbackMode") != "lipSync"
                or sequence.get("fps") != LIP_SYNC_FPS
                or len(frames) != 3
                or any(
                    not str(frame.get("assetId", "")).startswith(expected_prefix)
                    for frame in frames
                )
            ):
                invalid_sequences.append(expression_id)
        curated_character_checks[character["id"]] = {
            "expectedCount": len(expected_ids),
            "installedCount": len(expected_ids & expressions.keys()),
            "missingExpressionIds": missing_ids,
            "wrongAssets": wrong_assets,
            "invalidSequences": invalid_sequences,
        }
    crowded_cast_layout_errors = [
        block["id"]
        for block in cast_blocks
        if len(block.get("members", [])) in {2, 3}
        and min(
            right - left
            for left, right in zip(
                sorted(member["transform"]["x"] for member in block["members"]),
                sorted(member["transform"]["x"] for member in block["members"])[1:],
                strict=False,
            )
        )
        < (56 if len(block.get("members", [])) == 2 else 35)
    ]
    logical_library = logical_library_entries(source_root, original_source_root)
    missing_mapping = [
        item["relative"]
        for item in logical_library
        if item["relative"] not in mapping.get("items", {})
    ]
    missing_cg_mapping = [
        spec["relative"] for spec in CG_ASSETS if spec["relative"] not in mapping.get("items", {})
    ]
    kagari = find_character(document, ("冈部篝", "幼年篝"))

    def display_name_value(dialogue: dict[str, Any]) -> str:
        character = character_by_id[dialogue["characterId"]]
        selected = dialogue.get("displayNameId") or character.get("defaultDisplayNameId")
        display = next(
            (item for item in character.get("displayNames", []) if item.get("id") == selected),
            None,
        )
        return str((display or {}).get("value") or character.get("name") or "")

    dialogue_by_id = {dialogue["id"]: dialogue for dialogue in dialogues}
    ensemble_character_id = find_character(document, ("众人",))["id"]
    multi_name_errors = [
        dialogue["id"]
        for dialogue in dialogues
        if (
            display_name_value(dialogue) == "众人"
            and (
                dialogue.get("characterId") != ensemble_character_id
                or dialogue.get("speakerIds") != [ensemble_character_id]
            )
        )
        or (
            dialogue.get("characterId") == ensemble_character_id
            and dialogue.get("speakerIds") != [ensemble_character_id]
        )
    ]
    kagari_unknown_name_errors = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("characterId") == kagari["id"]
        and int(dialogue["id"].rsplit("-", 1)[1]) <= 116
        and display_name_value(dialogue) != "红发小女孩"
    ]
    kagari_known_name_errors = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("characterId") == kagari["id"]
        and int(dialogue["id"].rsplit("-", 1)[1]) >= 118
        and display_name_value(dialogue) != "冈部篝"
    ]
    checks = {
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueCount": len(dialogues),
        "allLipSyncFps5": bool(lip_sync_fps) and set(lip_sync_fps) == {LIP_SYNC_FPS},
        "dialogueBoxSemiTransparent": (
            document.get("presentation", {}).get("dialogueBox", {}).get("backgroundColor")
            == "#05070B"
            and document.get("presentation", {}).get("dialogueBox", {}).get("backgroundOpacity")
            == DIALOGUE_BOX_OPACITY
            and document.get("presentation", {})
            .get("dialogueBox", {})
            .get("background", {})
            .get("gradientTopOpacity")
            == 1
            and document.get("presentation", {})
            .get("dialogueBox", {})
            .get("background", {})
            .get("gradientBottomOpacity")
            == 1
        ),
        "dialogueBodyFontSizePx": document.get("presentation", {})
        .get("dialogueBox", {})
        .get("body", {})
        .get("fontSizePx"),
        "dialogueBodyMaxWidthPercent": document.get("presentation", {})
        .get("dialogueBox", {})
        .get("body", {})
        .get("maxWidthPercent"),
        "explicitExpressionCueCount": len(DIALOGUE_EXPRESSION_CUES),
        "visibleDialogueCount": len(visible_dialogues),
        "hiddenDialogueCount": len(hidden_dialogues),
        "groupCgDialogueCount": len(group_dialogues),
        "qOverlayDialogueCount": len(q_overlay_dialogues),
        "groupCgCoverage": group_cg_coverage,
        "invalidExpressionDialogues": invalid_expression_dialogues,
        "poseVarietyByCharacter": pose_variety_by_character,
        "missingPoseVariety": missing_pose_variety,
        "expressionLabelMismatches": expression_label_mismatches,
        "ambiguousExpressionLabels": ambiguous_expression_labels,
        "visibleHiddenPortraits": visible_hidden_portraits,
        "stageManagedVisiblePortraits": stage_managed_visible_portraits,
        "duplicatePortraitLayerDialogues": duplicate_portrait_layer_dialogues,
        "hiddenVisiblePortraits": hidden_visible_portraits,
        "groupVisiblePortraits": group_visible_portraits,
        "qOverlayVisiblePortraits": q_overlay_visible_portraits,
        "staleCastExpressions": stale_cast_expressions,
        "nearDialogueCount": len(near_dialogue_ids),
        "nearDialogueIdsMatchCurated": near_dialogue_ids == SAFE_CLOSEUP_DIALOGUE_IDS,
        "unsafeCharacterFrames": unsafe_frames,
        "floatingCharacterFrames": floating_frames,
        "maxCastSize": max((len(block.get("members", [])) for block in cast_blocks), default=0),
        "crowdedCastLayoutErrors": crowded_cast_layout_errors,
        "firstPersonNeverVisible": all(
            first_person_id not in {member["characterId"] for member in block.get("members", [])}
            for block in cast_blocks
        ),
        "sceneBeatCount": len(scene_blocks),
        "sceneBeatsExact": scene_beats == expected_scene_beats,
        "sceneTransitionsReady": all(
            (block["transition"]["durationMs"], block["transition"]["fade"])
            == (
                (0, False)
                if block["atMs"] == 0
                or block["atMs"] in HIDDEN_SCENE_SWITCH_MS
                or block["atMs"] in CG_EVENT_STARTS
                else (450, True)
                if block["atMs"] == 387_752
                else (350, True)
            )
            for block in scene_blocks
        ),
        "sceneEventsInsideCgs": scene_events_inside_cgs,
        "distinctSceneCount": len({block["sceneId"] for block in scene_blocks}),
        "cameraBeatCount": len(camera_blocks),
        "cameraUiIsolationReady": all(
            block.get("target")
            == ("cg" if block.get("id", "").startswith("runaway-phone-camera-") else "background")
            for block in camera_blocks
        ),
        "silentGapCount": len(silent_gaps),
        "nonemptySilentGaps": nonempty_silent_gaps,
        "curtainCount": len(curtain_blocks),
        "curtainEventsExact": sorted(
            (
                block["id"],
                block["atMs"],
                block["action"],
                block["durationMs"],
            )
            for block in curtain_blocks
        )
        == sorted(
            (
                block["id"],
                block["atMs"],
                block["action"],
                block["durationMs"],
            )
            for block in TRANSITION_CARD_BLOCKS
            if block["type"] == "curtain"
        ),
        "transitionTextsExact": sorted(
            (block.get("atMs"), block.get("text"), block.get("durationMs"))
            for block in fragment.get("blocks", [])
            if block.get("id", "").startswith("runaway-transition-")
        )
        == [
            (368_743, "众人前往屋顶......", 3_700),
            (451_633, "众人回到lab......", 4_800),
            (683_114, "玲羽和众人解释一番过后......", 3_358),
        ],
        "characterFadeBlocks": character_fades,
        "showCgCount": len(show_cg_blocks),
        "hideCgCount": len(hide_cg_blocks),
        "managedCgDefinitionsReady": managed_cg_ids <= {cg["id"] for cg in document.get("cgs", [])},
        "duplicateCgEventIds": len(cg_event_ids) != len(set(cg_event_ids)),
        "cgOverlaps": cg_overlaps,
        "qOverlayReady": len(q_events) == 3
        and all(
            event["displayMode"] == "overlay"
            and event["overlay"]["x"] == 50
            and event["overlay"]["y"] == 50
            and abs((event["overlay"]["width"] / 100) ** 2 - 1 / 6) <= 0.01
            for event in q_events
        ),
        "openingDeclarationReady": len(opening_declaration_blocks) == 1
        and opening_declaration_blocks[0].get("atMs") == 500
        and opening_declaration_blocks[0].get("durationMs") == 10_000
        and opening_declaration_blocks[0].get("text") == OPENING_DECLARATION_TEXT
        and opening_declaration_blocks[0].get("x") == 50
        and opening_declaration_blocks[0].get("y") == 50
        and opening_declaration_blocks[0].get("color") == "#F4E7C5",
        "openingCgBeforeVoice": bool(opening_event)
        and opening_event["startMs"] == 0
        and opening_event["endMs"] == 11_500
        and opening_event["endMs"] < first_dialogue_start_ms,
        "finalCgHandsOffToThanks": final_cg_hands_off_to_thanks,
        "endingThanksReady": len(ending_thanks_blocks) == 1
        and ending_thanks_blocks[0].get("atMs") == 1_774_194
        and ending_thanks_blocks[0].get("durationMs") == 6_150
        and ending_thanks_blocks[0].get("text") == ENDING_THANKS_TEXT
        and ending_thanks_blocks[0].get("x") == 50
        and ending_thanks_blocks[0].get("y") == 50
        and ending_thanks_blocks[0].get("color") == "#F4E7C5"
        and dialogues[-1].get("hideDialogueAfter") is True,
        "fullscreenCgTimingErrors": fullscreen_timing_errors,
        "cgEntryStageFlashRisks": cg_entry_stage_flash_risks,
        "cgEntryPortraitFlashRisks": cg_entry_portrait_flash_risks,
        "fullscreenCgVisiblePortraits": fullscreen_visible_portraits,
        "suzuhaUsesSg0BlueVest": bool(suzuha_asset_ids)
        and all(
            asset_id.startswith(("sg0-suz-half-v1-suz-hs", "sg0-suz-hm"))
            for asset_id in suzuha_asset_ids
        )
        and any("hsd" in asset_id for asset_id in suzuha_asset_ids)
        and any("hse" in asset_id for asset_id in suzuha_asset_ids)
        and any("hmd" in asset_id for asset_id in suzuha_asset_ids)
        and any("hme" in asset_id for asset_id in suzuha_asset_ids),
        "suzuhaCropFrameDimensions": sorted(suzuha_crop_dimensions),
        "curatedCharacterExpressions": curated_character_checks,
        "farisUsesRuffledCasualOutfit": all(
            next(
                expression
                for expression in find_character(document, ("菲莉丝",))["expressions"]
                if expression["id"] == f"e{variant:03d}-f000"
            )["assetId"].startswith("sg0-fei-dla-")
            for variant in range(1, 5)
        ),
        "lukaUsesBlackCasualOutfit": all(
            next(
                expression
                for expression in find_character(document, ("漆原琉华",))["expressions"]
                if expression["id"] == f"e{variant:03d}-f000"
            )["assetId"].startswith("sg0-ruk-cla-")
            for variant in range(1, 7)
        ),
        "kagariCharacterName": kagari["name"],
        "kagariUnknownNameErrors": kagari_unknown_name_errors,
        "kagariKnownNameErrors": kagari_known_name_errors,
        "multiNameErrors": multi_name_errors,
        "pairNamesExact": display_name_value(dialogue_by_id["runaway-annotated-line-0377"])
        == "冈部伦太郎、桥田至"
        and display_name_value(dialogue_by_id["runaway-annotated-line-0463"])
        == "阿万音铃羽、比屋定真帆",
        "rejectedSceneReferences": [
            block["sceneId"] for block in scene_blocks if block["sceneId"] == "sg0-bg03a3"
        ],
        "logicalLibraryCount": len(logical_library),
        "missingLogicalMappings": missing_mapping,
        "missingCgMappings": missing_cg_mapping,
        "blockCount": len(fragment.get("blocks", [])),
        "annotation": annotation_audit,
    }
    if checks["durationMs"] != 1_780_344 or checks["dialogueCount"] != 514:
        raise RuntimeError(f"对白或时间轴审计失败：{checks}")
    if not checks["allLipSyncFps5"]:
        raise RuntimeError("仍有唇形序列不是 5 FPS")
    if not checks["dialogueBoxSemiTransparent"]:
        raise RuntimeError("对白框没有保持最高层半透明样式")
    if checks["dialogueBodyFontSizePx"] != 34 or checks["dialogueBodyMaxWidthPercent"] != 100:
        raise RuntimeError("对白正文字号或可用宽度未按 V8 应用")
    if (
        checks["explicitExpressionCueCount"] != 410
        or invalid_expression_dialogues
        or missing_pose_variety
        or expression_label_mismatches
        or ambiguous_expression_labels
        or visible_hidden_portraits
        or stage_managed_visible_portraits
        or duplicate_portrait_layer_dialogues
        or hidden_visible_portraits
        or group_visible_portraits
        or q_overlay_visible_portraits
        or stale_cast_expressions
        or fullscreen_visible_portraits
        or checks["visibleDialogueCount"]
        + checks["hiddenDialogueCount"]
        + checks["groupCgDialogueCount"]
        + checks["qOverlayDialogueCount"]
        != 514
    ):
        raise RuntimeError(
            "逐句表情或隐藏人物审计失败："
            + json.dumps(
                {
                    "explicitExpressionCueCount": checks["explicitExpressionCueCount"],
                    "invalidExpressionDialogues": invalid_expression_dialogues,
                    "poseVarietyByCharacter": pose_variety_by_character,
                    "missingPoseVariety": missing_pose_variety,
                    "expressionLabelMismatches": expression_label_mismatches,
                    "ambiguousExpressionLabels": ambiguous_expression_labels,
                    "visibleHiddenPortraits": visible_hidden_portraits,
                    "stageManagedVisiblePortraits": stage_managed_visible_portraits,
                    "duplicatePortraitLayerDialogues": duplicate_portrait_layer_dialogues,
                    "hiddenVisiblePortraits": hidden_visible_portraits,
                    "groupVisiblePortraits": group_visible_portraits,
                    "qOverlayVisiblePortraits": q_overlay_visible_portraits,
                    "staleCastExpressions": stale_cast_expressions,
                    "fullscreenVisiblePortraits": fullscreen_visible_portraits,
                },
                ensure_ascii=False,
            )
        )
    if (
        not checks["nearDialogueIdsMatchCurated"]
        or checks["nearDialogueCount"] != 16
        or unsafe_frames
        or floating_frames
    ):
        raise RuntimeError("安全近景或顶部安全区审计失败")
    if (
        checks["maxCastSize"] > 3
        or checks["crowdedCastLayoutErrors"]
        or not checks["firstPersonNeverVisible"]
    ):
        raise RuntimeError(
            "舞台人数或第一人称冈部审计失败："
            f"maxCastSize={checks['maxCastSize']}, "
            f"crowdedCastLayoutErrors={checks['crowdedCastLayoutErrors']}, "
            f"firstPersonNeverVisible={checks['firstPersonNeverVisible']}"
        )
    if (
        checks["sceneBeatCount"] != len(SCENE_BEATS)
        or not checks["sceneBeatsExact"]
        or not checks["sceneTransitionsReady"]
        or checks["sceneEventsInsideCgs"]
        or checks["distinctSceneCount"] < 7
        or checks["rejectedSceneReferences"]
    ):
        raise RuntimeError("场景丰富度没有达到验收条件")
    if (
        checks["cameraBeatCount"] < 12
        or not checks["cameraUiIsolationReady"]
        or not checks["suzuhaUsesSg0BlueVest"]
        or checks["suzuhaCropFrameDimensions"] != [(482, 960)]
    ):
        raise RuntimeError(
            "镜头、静默区间、第一人称反应或铃羽素材审计失败："
            + json.dumps(
                {
                    key: checks[key]
                    for key in (
                        "cameraBeatCount",
                        "cameraUiIsolationReady",
                        "suzuhaUsesSg0BlueVest",
                    )
                },
                ensure_ascii=False,
            )
        )
    if (
        not checks["farisUsesRuffledCasualOutfit"]
        or not checks["lukaUsesBlackCasualOutfit"]
        or any(
            item["missingExpressionIds"]
            or item["wrongAssets"]
            or item["invalidSequences"]
            or item["installedCount"] != item["expectedCount"]
            for item in checks["curatedCharacterExpressions"].values()
        )
    ):
        raise RuntimeError(
            "精选私服或扩充表情素材审计失败："
            + json.dumps(
                {
                    "farisUsesRuffledCasualOutfit": checks["farisUsesRuffledCasualOutfit"],
                    "lukaUsesBlackCasualOutfit": checks["lukaUsesBlackCasualOutfit"],
                    "curatedCharacterExpressions": checks["curatedCharacterExpressions"],
                },
                ensure_ascii=False,
            )
        )
    if (
        checks["showCgCount"] != len(CG_EVENTS)
        or checks["hideCgCount"] != sum(event["endMs"] is not None for event in CG_EVENTS)
        or not checks["managedCgDefinitionsReady"]
        or checks["duplicateCgEventIds"]
        or cg_overlaps
        or not checks["qOverlayReady"]
        or not checks["openingDeclarationReady"]
        or not checks["openingCgBeforeVoice"]
        or not checks["finalCgHandsOffToThanks"]
        or not checks["endingThanksReady"]
        or checks["fullscreenCgTimingErrors"]
        or checks["cgEntryStageFlashRisks"]
        or checks["cgEntryPortraitFlashRisks"]
        or not all(checks["groupCgCoverage"].values())
        or checks["blockCount"] > 1000
    ):
        raise RuntimeError(
            "CG 事件或 Block 上限审计失败："
            + json.dumps(
                {
                    key: checks[key]
                    for key in (
                        "showCgCount",
                        "hideCgCount",
                        "duplicateCgEventIds",
                        "cgOverlaps",
                        "qOverlayReady",
                        "openingDeclarationReady",
                        "openingCgBeforeVoice",
                        "finalCgHandsOffToThanks",
                        "endingThanksReady",
                        "fullscreenCgTimingErrors",
                        "cgEntryStageFlashRisks",
                        "cgEntryPortraitFlashRisks",
                        "blockCount",
                    )
                },
                ensure_ascii=False,
            )
        )
    if checks["logicalLibraryCount"] != 701 or missing_mapping or missing_cg_mapping:
        raise RuntimeError("原作素材映射不完整")
    if (
        checks["curtainCount"]
        != sum(block["type"] == "curtain" for block in TRANSITION_CARD_BLOCKS)
        or not checks["curtainEventsExact"]
        or not checks["transitionTextsExact"]
        or checks["characterFadeBlocks"]
    ):
        raise RuntimeError("场景幕布、过场文字或人物淡化审计失败")
    if (
        checks["kagariCharacterName"] != "冈部篝"
        or checks["kagariUnknownNameErrors"]
        or checks["kagariKnownNameErrors"]
        or checks["multiNameErrors"]
        or not checks["pairNamesExact"]
    ):
        raise RuntimeError("对白显示名称审计失败")
    if annotation_audit is not None:
        if (
            annotation_audit["sha256"] != EXPECTED_ANNOTATION_SHA256
            or annotation_audit["rawMultiSpeakerCount"] != EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES
            or annotation_audit["multiSpeakerCount"] != EXPECTED_STORY_MULTI_SPEAKER_LINES
            or annotation_audit["crowdNormalizedCount"] != EXPECTED_CROWD_NORMALIZED_LINES
            or annotation_audit["storyMultiSpeakerCount"] != EXPECTED_STORY_MULTI_SPEAKER_LINES
            or dialogue_signature(fragment) != annotation_audit["expectedDialogueSignature"]
        ):
            raise RuntimeError("新版对白标注审计失败")
    return checks
