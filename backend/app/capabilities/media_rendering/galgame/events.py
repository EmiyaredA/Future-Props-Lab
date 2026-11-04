from __future__ import annotations

from typing import Any

from app.capabilities.media_rendering.galgame.timing import estimate_block_ms
from app.capabilities.media_rendering.galgame.values import (
    camera_values,
    dialogue_speaker_ids,
)

CompilerEvent = tuple[int, int, str, dict[str, Any]]


def timed_events(fragment: dict[str, Any]) -> list[CompilerEvent]:
    events: list[CompilerEvent] = []
    for block in fragment.get("blocks", []):
        if block.get("startMs") is not None and block.get("endMs") is not None:
            events.append((int(block["startMs"]), 20, "content-start", block))
            events.append((int(block["endMs"]), 10, "content-end", block))
            portrait = block.get("portrait") or {}
            if (
                block.get("type") == "dialogue"
                and portrait.get("mode") == "stage"
                and portrait.get("keepAfter") is False
            ):
                transition_ms = int((portrait.get("transition") or {}).get("durationMs", 240))
                events.append((int(block["endMs"]) + transition_ms, 11, "actor-exit-end", block))
        elif block.get("atMs") is not None:
            events.append((int(block["atMs"]), 15, "automatic", block))
            if block.get("type") in {"setStageCast", "removeCharacter"}:
                transition_key = (
                    "exitTransition" if block.get("type") == "setStageCast" else "transition"
                )
                transition_ms = int((block.get(transition_key) or {}).get("durationMs", 240))
                events.append(
                    (
                        int(block["atMs"]) + transition_ms,
                        16 if transition_ms == 0 else 11,
                        "actor-transition-end",
                        block,
                    )
                )
            if block.get("type") == "animateSprite" and not block.get("loop"):
                events.append(
                    (
                        int(block["atMs"]) + int(block.get("durationMs", 500)),
                        12,
                        "animation-end",
                        block,
                    )
                )
            if block.get("type") == "stageAnimation":
                events.append(
                    (
                        int(block["atMs"]) + int(block.get("durationMs", 500)),
                        12,
                        "stage-animation-end",
                        block,
                    )
                )
            if block.get("type") in {"camera", "resetCamera"}:
                events.append(
                    (
                        int(block["atMs"]) + int(block.get("durationMs", 0)),
                        12,
                        "camera-transition-end",
                        block,
                    )
                )
            if block.get("type") in {"scene", "showCg", "hideCg", "curtain"}:
                transition = block.get("transition") or block
                transition_ms = int(transition.get("durationMs", 0))
                events.append(
                    (
                        int(block["atMs"]) + transition_ms,
                        16 if transition_ms == 0 else 12,
                        "visual-transition-end",
                        block,
                    )
                )
    return sorted(events, key=lambda item: (item[0], item[1]))


def sequential_events(
    fragment: dict[str, Any], asset_duration: dict[str, int]
) -> tuple[list[CompilerEvent], int]:
    events: list[CompilerEvent] = []
    cursor = 0
    automatic = {
        "scene",
        "showCg",
        "hideCg",
        "showCharacter",
        "setStageCast",
        "removeCharacter",
        "destroyScene",
        "camera",
        "resetCamera",
        "particle",
        "stageAnimation",
        "floatingText",
        "curtain",
        "video",
        "animateSprite",
        "autoPlay",
        "switchDialogueStyle",
        "portraitStyleRule",
        "audio",
        "setVariable",
        "paragraphParams",
    }
    for block in fragment.get("blocks", []):
        block_type = block.get("type")
        duration, _exact = estimate_block_ms(block, asset_duration)
        if block_type in automatic:
            started = cursor
            events.append((started, 15, "automatic", block))
            if block_type in {"setStageCast", "removeCharacter"}:
                transition_key = "exitTransition" if block_type == "setStageCast" else "transition"
                transition_ms = int((block.get(transition_key) or {}).get("durationMs", 240))
                events.append(
                    (
                        started + transition_ms,
                        16 if transition_ms == 0 else 11,
                        "actor-transition-end",
                        block,
                    )
                )
            if block_type == "animateSprite" and not block.get("loop"):
                events.append((started + duration, 12, "animation-end", block))
            if block_type == "stageAnimation":
                events.append((started + duration, 12, "stage-animation-end", block))
            if block_type in {"camera", "resetCamera"}:
                events.append((started + duration, 12, "camera-transition-end", block))
            if block_type in {"scene", "showCg", "hideCg", "curtain"}:
                events.append(
                    (
                        started + duration,
                        16 if duration == 0 else 12,
                        "visual-transition-end",
                        block,
                    )
                )
            if block.get("waitForCompletion"):
                cursor += duration
            continue
        if block_type in {"dialogue", "narration", "storyParagraph", "systemMessage"}:
            duration = max(1, duration)
            events.append((cursor, 20, "content-start", block))
            events.append((cursor + duration, 10, "content-end", block))
            portrait = block.get("portrait") or {}
            if (
                block_type == "dialogue"
                and portrait.get("mode") == "stage"
                and portrait.get("keepAfter") is False
            ):
                transition_ms = int((portrait.get("transition") or {}).get("durationMs", 240))
                events.append((cursor + duration + transition_ms, 11, "actor-exit-end", block))
            cursor += duration
        elif block_type == "wait":
            cursor += duration
    return sorted(events, key=lambda item: (item[0], item[1])), cursor


def apply_event(
    state: dict[str, Any], action: str, block: dict[str, Any], *, absolute_us: int
) -> None:
    if action == "content-end":
        if state.get("content", {}).get("id") == block.get("id"):
            previous_speakers = dialogue_speaker_ids(block)
            previous_speaker = previous_speakers[0] if previous_speakers else None
            state["content"] = None
            state["contentStartedUs"] = None
            state["focusTransition"] = {
                "startedUs": absolute_us,
                "from": previous_speaker,
                "fromIds": previous_speakers,
                "to": None,
                "toIds": (),
            }
            state["lastSpeaker"] = previous_speaker
            state["lastSpeakerIds"] = previous_speakers
        portrait = block.get("portrait") or {}
        if (
            block.get("type") == "dialogue"
            and portrait.get("mode") == "stage"
            and portrait.get("keepAfter") is False
        ):
            actor = state["actors"].get(block.get("characterId"))
            if actor:
                actor.update(
                    exiting=True,
                    exitStartedUs=absolute_us,
                    exitSourceBlockId=block.get("id"),
                    transition=portrait.get("transition") or {},
                )
        return
    if action == "actor-exit-end":
        character_id = block.get("characterId")
        actor = state["actors"].get(character_id)
        if actor and actor.get("exitSourceBlockId") == block.get("id"):
            state["actors"].pop(character_id, None)
        return
    if action == "actor-transition-end":
        source_block_id = block.get("id")
        state["actors"] = {
            character_id: actor
            for character_id, actor in state["actors"].items()
            if actor.get("exitSourceBlockId") != source_block_id
        }
        return
    if action == "camera-transition-end":
        return
    if action == "visual-transition-end":
        if block.get("type") == "scene":
            if (state.get("scene") or {}).get("sourceBlockId") == block.get("id"):
                state["scene"]["entering"] = False
            if (state.get("exitingScene") or {}).get("exitSourceBlockId") == block.get("id"):
                state["exitingScene"] = None
        if block.get("type") in {"showCg", "hideCg"}:
            if (state.get("cg") or {}).get("sourceBlockId") == block.get("id"):
                state["cg"]["entering"] = False
            if (state.get("exitingCg") or {}).get("exitSourceBlockId") == block.get("id"):
                state["exitingCg"] = None
        if (
            block.get("type") == "curtain"
            and block.get("action") == "hide"
            and state.get("curtain", {}).get("sourceBlockId") == block.get("id")
        ):
            state["curtain"] = None
        return
    if action == "animation-end":
        character_id = block.get("characterId")
        active = state.get("spriteAnimations", {}).get(character_id)
        if active and active.get("sourceBlockId") == block.get("id"):
            state["spriteAnimations"].pop(character_id, None)
        return
    if action == "stage-animation-end":
        active = state.get("stageAnimation")
        if active and active.get("sourceBlockId") == block.get("id"):
            state["stageAnimation"] = None
        return
    if action == "content-start":
        previous_content = state.get("content") or {}
        previous_speakers = dialogue_speaker_ids(previous_content)
        if state.get("focusTransition", {}).get("startedUs") == absolute_us:
            previous_speakers = tuple(state.get("lastSpeakerIds") or ())
        previous_speaker = previous_speakers[0] if previous_speakers else None
        state["content"] = block
        state["contentStartedUs"] = absolute_us
        next_speakers = dialogue_speaker_ids(block)
        next_speaker = next_speakers[0] if next_speakers else None
        state["focusTransition"] = {
            "startedUs": absolute_us,
            "from": previous_speaker,
            "fromIds": previous_speakers,
            "to": next_speaker,
            "toIds": next_speakers,
        }
        state["lastSpeaker"] = None
        state["lastSpeakerIds"] = ()
        if block.get("type") == "dialogue":
            character_id = block.get("characterId")
            actor = state["actors"].get(character_id, {"characterId": character_id})
            if "expressionId" in block:
                expression_id = block.get("expressionId")
                if actor.get("expressionId") != expression_id:
                    actor["expressionStartedUs"] = absolute_us
                # ``null`` means “follow the character default”, matching the
                # browser player. Keeping the previous expression here makes a
                # fast-preview edit look correct but export the stale face.
                actor["expressionId"] = expression_id
            portrait = block.get("portrait") or {}
            if portrait.get("visible", True) and portrait.get("mode") != "dialogueAvatar":
                entering = character_id not in state["actors"]
                position_id = portrait.get("positionId")
                transform = portrait.get("transform")
                distance = portrait.get("distance")
                actor.update(
                    # The quick editor deliberately serializes inherited values
                    # as null. Treat null like the browser's ?? fallback so an
                    # existing stage-cast transform (notably scale/layer/flip)
                    # survives a dialogue-only position or distance edit.
                    positionId=actor.get("positionId") if position_id is None else position_id,
                    transform=actor.get("transform", {}) if transform is None else transform,
                    distance=actor.get("distance", "medium") if distance is None else distance,
                    # A dialogue portrait without a skin explicitly returns to
                    # the character's default skin in the browser player.
                    skinId=portrait.get("skinId"),
                    entering=entering,
                    enterStartedUs=absolute_us if entering else actor.get("enterStartedUs"),
                    transition=portrait.get("transition") or {"durationMs": 240, "fade": True},
                    exiting=False,
                    exitSourceBlockId=None,
                )
                actor.setdefault("expressionStartedUs", absolute_us)
                state["actors"][character_id] = actor
        return
    kind = block.get("type")
    if kind == "scene":
        transition = block.get("transition") or {"durationMs": 0, "fade": False}
        previous = state.get("scene")
        if previous and previous.get("sceneId") != block.get("sceneId"):
            state["exitingScene"] = {
                **previous,
                "entering": False,
                "exiting": True,
                "transitionStartedUs": absolute_us,
                "durationMs": int(transition.get("durationMs", 0)),
                "fade": bool(transition.get("fade", False)),
                "exitSourceBlockId": block.get("id"),
            }
        else:
            state["exitingScene"] = None
        state["sceneId"] = block.get("sceneId")
        state["scene"] = {
            "sourceBlockId": block.get("id"),
            "sceneId": block.get("sceneId"),
            "entering": previous is None or previous.get("sceneId") != block.get("sceneId"),
            "exiting": False,
            "transitionStartedUs": absolute_us,
            "durationMs": int(transition.get("durationMs", 0)),
            "fade": bool(transition.get("fade", False)),
        }
        if block.get("clearCharacters", True):
            state["actors"] = {}
    elif kind == "showCg":
        transition = block.get("transition") or {}
        if state.get("cg"):
            state["exitingCg"] = {
                **state["cg"],
                "entering": False,
                "exiting": True,
                "transitionStartedUs": absolute_us,
                "durationMs": int(transition.get("durationMs", 0)),
                "fade": bool(transition.get("fade", True)),
                "exitSourceBlockId": block.get("id"),
            }
        else:
            state["exitingCg"] = None
        state["cg"] = {
            **block,
            "entering": True,
            "exiting": False,
            "transitionStartedUs": absolute_us,
            "durationMs": int(transition.get("durationMs", 0)),
            "fade": bool(transition.get("fade", True)),
            "sourceBlockId": block.get("id"),
        }
    elif kind == "hideCg":
        if state.get("cg"):
            transition = block.get("transition") or {}
            state["exitingCg"] = {
                **state["cg"],
                "entering": False,
                "exiting": True,
                "transitionStartedUs": absolute_us,
                "durationMs": int(transition.get("durationMs", 0)),
                "fade": bool(transition.get("fade", True)),
                "exitSourceBlockId": block.get("id"),
            }
            state["cg"] = None
    elif kind == "showCharacter":
        state["actors"][block.get("characterId")] = {
            **block,
            "entering": True,
            "enterStartedUs": absolute_us,
            "expressionStartedUs": absolute_us,
        }
    elif kind == "setStageCast":
        previous = state["actors"]
        members = {item.get("characterId"): dict(item) for item in block.get("members", [])}
        next_actors: dict[str, Any] = {}
        for character_id, actor in previous.items():
            if character_id not in members:
                next_actors[character_id] = {
                    **actor,
                    "entering": False,
                    "exiting": True,
                    "exitStartedUs": absolute_us,
                    "exitSourceBlockId": block.get("id"),
                    "transition": block.get("exitTransition") or {},
                }
        for character_id, member in members.items():
            existing = previous.get(character_id)
            expression_changed = bool(
                existing
                and member.get("expressionId")
                and existing.get("expressionId") != member.get("expressionId")
            )
            next_actors[character_id] = {
                **(existing or {}),
                **member,
                "entering": existing is None,
                "enterStartedUs": absolute_us
                if existing is None
                else existing.get("enterStartedUs"),
                "exiting": False,
                "exitSourceBlockId": None,
                "expressionStartedUs": absolute_us
                if existing is None or expression_changed
                else existing.get("expressionStartedUs", absolute_us),
            }
        state["actors"] = next_actors
    elif kind == "removeCharacter":
        targets = list(state["actors"]) if block.get("all") else [block.get("characterId")]
        for character_id in targets:
            actor = state["actors"].get(character_id)
            if actor:
                actor.update(
                    entering=False,
                    exiting=True,
                    exitStartedUs=absolute_us,
                    exitSourceBlockId=block.get("id"),
                    transition=block.get("transition") or {},
                )
    elif kind == "destroyScene":
        state.update(
            sceneId=None,
            scene=None,
            exitingScene=None,
            actors={},
            cg=None,
            exitingCg=None,
            content=None,
        )
    elif kind == "curtain":
        previous = state.get("curtain") or {}
        transition = block.get("transition") or block
        state["curtain"] = {
            **previous,
            **block,
            "entering": block.get("action") == "show",
            "exiting": block.get("action") == "hide",
            "transitionStartedUs": absolute_us,
            "durationMs": int(transition.get("durationMs", 0)),
            "sourceBlockId": block.get("id"),
        }
    elif kind == "video":
        state["video"] = block if block.get("action") == "play" else None
        state["videoStartedUs"] = absolute_us
    elif kind in {"camera", "resetCamera"}:
        previous = camera_values(state.get("camera"), absolute_us)
        target = (
            {"x": 0.0, "y": 0.0, "scale": 1.0, "rotation": 0.0}
            if kind == "resetCamera"
            else {
                "x": float(block.get("x", 0)),
                "y": float(block.get("y", 0)),
                "scale": float(block.get("scale", 1)),
                "rotation": float(block.get("rotation", 0)),
            }
        )
        state["camera"] = {
            "from": previous,
            "to": target,
            "target": "stage" if kind == "resetCamera" else block.get("target", "stage"),
            "startedUs": absolute_us,
            "durationUs": int(block.get("durationMs", 0)) * 1000,
            "easing": block.get("easing", "easeInOut"),
            "effect": block.get("effect", "move"),
        }
    elif kind == "animateSprite":
        state["spriteAnimations"][block.get("characterId")] = {
            **block,
            "sourceBlockId": block.get("id"),
            "startedUs": absolute_us,
        }
    elif kind == "stageAnimation":
        state["stageAnimation"] = {
            **block,
            "sourceBlockId": block.get("id"),
            "startedUs": absolute_us,
        }
    elif kind == "switchDialogueStyle":
        state["dialoguePreset"] = block.get("preset")
    elif kind == "paragraphParams":
        state["paragraphParams"] = {**state.get("paragraphParams", {}), **block}
    elif kind == "setVariable":
        variable_id = str(block.get("variableId"))
        current = state["variables"].get(variable_id)
        value = block.get("value")
        operator = block.get("operator", "set")
        if operator == "toggle":
            value = not bool(current)
        elif isinstance(current, (int, float)) and isinstance(value, (int, float)):
            if operator == "add":
                value = current + value
            elif operator == "subtract":
                value = current - value
            elif operator == "multiply":
                value = current * value
            elif operator == "divide":
                value = current if value == 0 else current / value
        state["variables"][variable_id] = value
