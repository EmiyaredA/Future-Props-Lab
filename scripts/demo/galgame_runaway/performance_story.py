# ruff: noqa: F403, F405, I001

from __future__ import annotations

from scripts.demo.galgame_runaway.performance_upgrade import *  # noqa: F403


def install_performance_blocks(document: dict[str, Any], first_person_id: str) -> None:
    fragment = target_fragment(document)
    original_signature = dialogue_signature(fragment)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    if len(dialogues) != 514:
        raise RuntimeError(f"目标时间轴对白应为 514 条，实际为 {len(dialogues)} 条")
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    visible_character_ids = {
        character["id"]
        for character in document.get("characters", [])
        if character.get("expressions") and character["id"] != first_person_id
    }
    group_character_id = find_character(document, ("众人",))["id"]
    removed_types = {
        "scene",
        "showCharacter",
        "setStageCast",
        "removeCharacter",
        "camera",
        "resetCamera",
        "animateSprite",
        "curtain",
    }
    retained = [
        block for block in fragment.get("blocks", []) if block.get("type") not in removed_types
    ]
    performance: list[dict[str, Any]] = []
    for beat_index, (at_ms, scene_code) in enumerate(SCENE_BEATS):
        hidden_scene_switch = at_ms in HIDDEN_SCENE_SWITCH_MS
        scene_transition_ms = (
            0
            if beat_index == 0 or hidden_scene_switch or at_ms in CG_EVENT_STARTS
            else 450
            if at_ms == 387_752
            else 350
        )
        performance.append(
            {
                "id": f"perf-scene-{beat_index:02d}",
                "type": "scene",
                "atMs": at_ms,
                "sceneId": scene_id_for_code(scene_code),
                "clearCharacters": True,
                "transition": {
                    "durationMs": scene_transition_ms,
                    "fade": scene_transition_ms > 0,
                },
            }
        )
        if beat_index:
            performance.append(
                {
                    "id": f"perf-camera-{beat_index:02d}",
                    "type": "camera",
                    "atMs": at_ms,
                    "target": "background",
                    "effect": "move" if beat_index % 3 else "zoomIn",
                    "x": (-2 if beat_index % 2 else 2),
                    "y": -1 if beat_index % 2 else 0,
                    "scale": 1 if beat_index % 4 == 3 else 1.04 + (beat_index % 3) * 0.025,
                    "rotation": 0,
                    "intensity": 0.5,
                    "durationMs": 5_000,
                    "easing": "easeInOut",
                    "waitForCompletion": False,
                }
            )

    last_expression_by_character: dict[str, str] = {}
    speaking_turn_by_character: dict[str, int] = {}
    motion_block_count = 0
    motion_block_limit = 24
    for cue_index, dialogue in enumerate(dialogues):
        character_id = dialogue.get("characterId")
        if character_id in visible_character_ids:
            try:
                speaking_turn = speaking_turn_by_character.get(character_id, 0)
                dialogue["expressionId"] = performance_expression_for_turn(
                    character_id,
                    DIALOGUE_EXPRESSION_CUES[dialogue["id"]],
                    speaking_turn,
                )
            except KeyError as exc:
                raise RuntimeError(f"对白缺少显式表情：{dialogue['id']}") from exc
            speaking_turn_by_character[character_id] = speaking_turn + 1
            last_expression_by_character[character_id] = dialogue["expressionId"]
        else:
            dialogue.pop("expressionId", None)
        for character_name, expression_id in CAST_EXPRESSION_OVERRIDES.get(dialogue["id"], ()):
            override_character_id = find_character(document, (character_name,))["id"]
            last_expression_by_character[override_character_id] = performance_expression_id(
                override_character_id, expression_id
            )
        visible_ids = visible_cast_for_dialogue(
            dialogues, cue_index, first_person_id, visible_character_ids
        )
        members: list[dict[str, Any]] = []
        for member_index, character_id in enumerate(visible_ids):
            expression_id = remembered_cast_expression(
                character_id,
                dialogue,
                character_by_id,
                last_expression_by_character,
            )
            members.append(
                cast_member(
                    document,
                    character_id,
                    expression_id,
                    member_index,
                    len(visible_ids),
                    dialogue["id"],
                )
            )
        explicit_group = len(dialogue.get("speakerIds") or []) > 1
        group_dialogue = explicit_group or dialogue.get("characterId") == group_character_id
        fullscreen_cg = fullscreen_cg_at(dialogue["startMs"])
        cg_hidden_dialogue = (
            group_dialogue or dialogue["id"] in Q_OVERLAY_DIALOGUE_IDS or fullscreen_cg is not None
        )
        requires_composition = (
            dialogue["characterId"] not in visible_character_ids
            or cg_hidden_dialogue
            or len(visible_ids) > 1
            or dialogue["id"] in SAFE_CLOSEUP_DIALOGUE_IDS
        )
        if requires_composition:
            cast_at_ms = dialogue["startMs"]
            if fullscreen_cg and fullscreen_cg["startMs"] == dialogue["startMs"]:
                # Keep the previous stage intact while the CG fades in. The new
                # cast is installed only once the CG is fully opaque, preventing
                # a one-frame portrait flash at every CG/dialogue boundary.
                cast_at_ms += fullscreen_cg["transitionMs"]
            performance.append(
                {
                    "id": f"perf-cast-{cue_index:03d}",
                    "type": "setStageCast",
                    "atMs": cast_at_ms,
                    "members": members,
                    "exitTransition": {"durationMs": 0, "fade": False},
                }
            )

        if requires_composition:
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": False,
                "distance": "medium",
                "keepAfter": True,
                "transition": {"durationMs": 0, "fade": False},
            }
        else:
            speaker_member = next(
                (member for member in members if member["characterId"] == dialogue["characterId"]),
                cast_member(
                    document,
                    dialogue["characterId"],
                    dialogue.get("expressionId"),
                    0,
                    1,
                    dialogue["id"],
                ),
            )
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": True,
                "distance": speaker_member["distance"],
                "positionId": speaker_member["positionId"],
                "keepAfter": True,
                "transform": speaker_member["transform"],
                "transition": {"durationMs": 0, "fade": False},
            }

        text = dialogue.get("text", "")
        if visible_ids and cue_index % 18 == 0 and motion_block_count < motion_block_limit:
            animation = (
                "startle"
                if any(mark in text for mark in ("！", "!"))
                else "lean"
                if any(mark in text for mark in ("？", "?"))
                else "nod"
            )
            performance.append(
                {
                    "id": f"perf-motion-{cue_index:03d}-0",
                    "type": "animateSprite",
                    "atMs": min(dialogue["endMs"] - 1, dialogue["startMs"] + 180),
                    "characterId": visible_ids[0],
                    "animation": animation,
                    "direction": "towardCenter",
                    "intensity": 0.8,
                    "easing": "easeOut",
                    "durationMs": 520,
                    "loop": False,
                    "waitForCompletion": False,
                }
            )
            motion_block_count += 1
        if (
            len(visible_ids) >= 2
            and 1_364_000 <= dialogue["startMs"] <= 1_604_000
            and cue_index % 11 == 0
            and motion_block_count < motion_block_limit
        ):
            for member_index, character_id in enumerate(visible_ids[:2]):
                if motion_block_count >= motion_block_limit:
                    break
                performance.append(
                    {
                        "id": f"perf-motion-{cue_index:03d}-{member_index + 1}",
                        "type": "animateSprite",
                        "atMs": min(dialogue["endMs"] - 1, dialogue["startMs"] + 220),
                        "characterId": character_id,
                        "animation": "tug",
                        "direction": "right" if member_index == 0 else "left",
                        "intensity": 0.65,
                        "easing": "easeInOut",
                        "durationMs": 680,
                        "loop": False,
                        "waitForCompletion": False,
                    }
                )
                motion_block_count += 1
    clear_adjacent_direct_portrait_overlaps(dialogues)
    dialogues[-1]["hideDialogueAfter"] = True
    fragment["blocks"] = [*performance, *retained]
    if len(fragment["blocks"]) > 1000:
        raise RuntimeError(f"演出 Block 超过上限：{len(fragment['blocks'])}")
    if dialogue_signature(fragment) != original_signature:
        raise RuntimeError("演出重编意外修改了对白文本或时间轴")
