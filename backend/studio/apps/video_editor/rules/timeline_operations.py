from __future__ import annotations

from copy import deepcopy
from math import floor

from studio.apps.media_rendering.local.audio_transitions import AUDIO_SEAM_KINDS
from studio.apps.video_editor.audio_alignment.audio_seam_edit import align_audio_seam
from studio.apps.video_editor.audio_alignment.audio_transition_edit import set_audio_transition
from studio.apps.video_editor.clip_merging.document import replace_selection
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.schemas import (
    VideoEditorClip,
    VideoEditorTimelineBatchIn,
)
from studio.apps.video_editor.timed_effect_edit import crop_timed_effects, scale_timed_effects


def find_clip(document: dict, clip_id: str) -> tuple[dict, dict]:
    for track in document["tracks"]:
        for clip in track["clips"]:
            if clip["id"] == clip_id:
                return track, clip
    raise VideoEditorValidationError("找不到指定 Clip", code="clip_not_found")


def _remove_clip(document: dict, clip_id: str) -> tuple[dict, dict]:
    track, clip = find_clip(document, clip_id)
    track["clips"].remove(clip)
    return track, clip


def _clip_dump(clip: VideoEditorClip) -> dict:
    return clip.model_dump(mode="json", by_alias=True, exclude_none=True)


def _transitions(document: dict) -> list[dict]:
    return document.setdefault("transitions", [])


def _remove_transitions_for_clip(document: dict, clip_id: str) -> None:
    transitions = _transitions(document)
    transitions[:] = [
        item
        for item in transitions
        if item.get("fromClipId") != clip_id and item.get("toClipId") != clip_id
    ]


def _reconcile_audio_crossfades(document: dict) -> None:
    transitions = document.get("transitions")
    if not transitions:
        return
    clips_by_id = {
        clip["id"]: (track, clip)
        for track in document.get("tracks", [])
        for clip in track.get("clips", [])
    }
    reconciled: list[dict] = []
    for transition in transitions:
        if transition.get("kind") not in AUDIO_SEAM_KINDS:
            reconciled.append(transition)
            continue
        from_entry = clips_by_id.get(transition.get("fromClipId"))
        to_entry = clips_by_id.get(transition.get("toClipId"))
        if not from_entry or not to_entry:
            continue
        from_track, from_clip = from_entry
        to_track, to_clip = to_entry
        if (
            from_track["id"] != to_track["id"]
            or from_track["kind"] != "audio"
            or from_clip["kind"] != "audio"
            or to_clip["kind"] != "audio"
        ):
            continue
        ordered = sorted(
            from_track["clips"],
            key=lambda clip: (clip["timelineStartUs"], clip["id"]),
        )
        try:
            from_index = next(
                index for index, clip in enumerate(ordered) if clip["id"] == from_clip["id"]
            )
        except StopIteration:
            continue
        if from_index + 1 >= len(ordered) or ordered[from_index + 1]["id"] != to_clip["id"]:
            continue
        overlap_us = (
            min(
                from_clip["timelineStartUs"] + from_clip["durationUs"],
                to_clip["timelineStartUs"] + to_clip["durationUs"],
            )
            - to_clip["timelineStartUs"]
        )
        if overlap_us <= 0 or from_clip["timelineStartUs"] >= to_clip["timelineStartUs"]:
            continue
        transition["durationUs"] = overlap_us
        reconciled.append(transition)
    document["transitions"] = reconciled


def apply_operations(
    document: dict, body: VideoEditorTimelineBatchIn, merge_contexts: dict[str, dict] | None = None
) -> dict:
    result = deepcopy(document)
    for operation in body.operations:
        data = operation.model_dump(mode="json", by_alias=True, exclude_none=True)
        kind = data.pop("type")
        guarded_ids = set(data.get("clipIds", []))
        if data.get("clipId"):
            guarded_ids.add(data["clipId"])
        if kind in {"alignAudioSeam", "setAudioTransition"}:
            guarded_ids.update((data["fromClipId"], data["toClipId"]))
        transition_payload = data.get("transition")
        if transition_payload:
            guarded_ids.update(
                clip_id
                for clip_id in (
                    transition_payload.get("fromClipId"),
                    transition_payload.get("toClipId"),
                )
                if clip_id
            )
        if data.get("transitionId"):
            existing_transition = next(
                (
                    item
                    for item in result.get("transitions", [])
                    if item.get("id") == data["transitionId"]
                ),
                None,
            )
            if existing_transition:
                guarded_ids.update(
                    clip_id
                    for clip_id in (
                        existing_transition.get("fromClipId"),
                        existing_transition.get("toClipId"),
                    )
                    if clip_id
                )
        if kind == "restoreClipStates":
            guarded_ids.update(item["id"] for item in data["clips"])
        linked_groups = {
            clip.get("linkGroupId")
            for track in result["tracks"]
            for clip in track["clips"]
            if clip["id"] in guarded_ids and clip.get("linkGroupId")
        }
        for track in result["tracks"]:
            target_id = data.get("trackId") or (data.get("clip") or {}).get("trackId")
            touches_locked = track["id"] == target_id and kind not in {
                "updateTrack",
                "reorderTrack",
            }
            touches_locked |= any(
                clip["id"] in guarded_ids or clip.get("linkGroupId") in linked_groups
                for clip in track["clips"]
            )
            if track.get("locked") and touches_locked:
                raise VideoEditorValidationError("轨道已锁定", code="track_locked")
        if kind in {"applyClipMerge", "undoClipMerge"}:
            context = (merge_contexts or {}).get(data["taskId"])
            if context is None:
                raise VideoEditorValidationError("合并任务尚未校验", code="merge_not_ready")
            result = replace_selection(
                result, context, data["newClipId"], undo=kind == "undoClipMerge"
            )
        elif kind == "updateSettings":
            allowed = {"fps", "backgroundColor", "videoFitPolicyVersion"}
            result["settings"].update(
                {key: value for key, value in data["patch"].items() if key in allowed}
            )
        elif kind == "setAssetOrganization":
            result["assetOrganization"] = data["organization"]
        elif kind == "addTrack":
            result["tracks"].append(data["track"])
        elif kind == "updateTrack":
            track = next((item for item in result["tracks"] if item["id"] == data["trackId"]), None)
            if track is None:
                raise VideoEditorValidationError("找不到指定轨道", code="track_not_found")
            patch = {
                key: value
                for key, value in data["patch"].items()
                if key in {"name", "locked", "hidden", "muted"}
            }
            track.update(patch)
        elif kind == "removeTrack":
            track = next((item for item in result["tracks"] if item["id"] == data["trackId"]), None)
            if track is None:
                raise VideoEditorValidationError("找不到指定轨道", code="track_not_found")
            result["tracks"].remove(track)
        elif kind == "reorderTrack":
            track = next((item for item in result["tracks"] if item["id"] == data["trackId"]), None)
            if track is None:
                raise VideoEditorValidationError("找不到指定轨道", code="track_not_found")
            track["order"] = data["order"]
        elif kind == "addClip":
            track = next(
                (item for item in result["tracks"] if item["id"] == data["clip"]["trackId"]), None
            )
            if track is None:
                raise VideoEditorValidationError("找不到目标轨道", code="track_not_found")
            clip_kind = data["clip"]["kind"]
            if (
                (track["kind"] == "mixed" and clip_kind not in {"video", "image"})
                or (track["kind"] == "audio" and clip_kind != "audio")
                or (track["kind"] == "visual" and clip_kind == "audio")
            ):
                raise VideoEditorValidationError("Clip 类型与轨道不匹配", code="invalid_track_kind")
            track["clips"].append(data["clip"])
        elif kind == "updateClip":
            _track, clip = find_clip(result, data["clipId"])
            allowed = {
                "name",
                "text",
                "color",
                "fontAssetId",
                "fontSize",
                "textColor",
                "textMaxWidth",
                "textStyle",
                "volume",
                "muted",
                "fitMode",
                "heightPercent",
                "transform",
                "chromaKey",
                "timedEffects",
            }
            clip.update({key: value for key, value in data["patch"].items() if key in allowed})
        elif kind == "moveClip":
            old_track, clip = _remove_clip(result, data["clipId"])
            target = next(
                (item for item in result["tracks"] if item["id"] == data["trackId"]), None
            )
            if target is None:
                old_track["clips"].append(clip)
                raise VideoEditorValidationError("找不到目标轨道", code="track_not_found")
            if (
                (
                    old_track["kind"] == "mixed"
                    and target["kind"] != "mixed"
                    and clip["kind"] == "video"
                )
                or (target["kind"] == "mixed" and clip["kind"] not in {"video", "image"})
                or (target["kind"] == "audio" and clip["kind"] != "audio")
                or (target["kind"] == "visual" and clip["kind"] == "audio")
            ):
                old_track["clips"].append(clip)
                raise VideoEditorValidationError("Clip 类型与轨道不匹配", code="invalid_track_kind")
            clip.update(trackId=data["trackId"], timelineStartUs=data["timelineStartUs"])
            target["clips"].append(clip)
        elif kind == "trimClip":
            track, clip = find_clip(result, data["clipId"])
            if track.get("locked"):
                raise VideoEditorValidationError(
                    "轨道已锁定，无法调整片段时长", code="track_locked"
                )
            offset = data["timelineStartUs"] - clip["timelineStartUs"]
            clip["timedEffects"] = crop_timed_effects(clip, offset, data["durationUs"])
            clip["keyframes"] = [
                {**key, "timeUs": key["timeUs"] - offset}
                for key in clip.get("keyframes", [])
                if 0 <= key["timeUs"] - offset <= data["durationUs"]
            ]
            for edge in ("transitionIn", "transitionOut"):
                if clip.get(edge):
                    clip[edge]["durationUs"] = min(clip[edge]["durationUs"], data["durationUs"])
            clip.update(
                timelineStartUs=data["timelineStartUs"],
                durationUs=data["durationUs"],
                sourceInUs=data["sourceInUs"],
            )
        elif kind == "setClipSpeed":
            selected_track, selected = find_clip(result, data["clipId"])
            group = selected.get("linkGroupId")
            old_end = selected["timelineStartUs"] + selected["durationUs"]
            delta = (
                max(
                    1,
                    floor(
                        selected["durationUs"]
                        * (selected.get("playbackRate", 1) / data["playbackRate"])
                    ),
                )
                - selected["durationUs"]
            )
            speed_ids = {
                clip["id"]
                for track in result["tracks"]
                for clip in track["clips"]
                if clip["id"] == selected["id"] or (group and clip.get("linkGroupId") == group)
            }
            following = [
                clip
                for clip in selected_track["clips"]
                if data["ripple"]
                and clip["timelineStartUs"] >= old_end
                and clip["id"] not in speed_ids
            ]
            following_ids = {clip["id"] for clip in following}
            following_groups = {
                clip["linkGroupId"] for clip in following if clip.get("linkGroupId")
            }
            for track in result["tracks"]:
                for clip in track["clips"]:
                    if clip["id"] not in speed_ids:
                        if delta and (
                            clip["id"] in following_ids
                            or clip.get("linkGroupId") in following_groups
                        ):
                            if track.get("locked"):
                                raise VideoEditorValidationError(
                                    "后续片段的轨道已锁定", code="track_locked"
                                )
                            start = clip["timelineStartUs"] + delta
                            if start < 0:
                                raise VideoEditorValidationError(
                                    "后续关联片段不能移到时间轴起点之前", code="invalid_clip_start"
                                )
                            clip["timelineStartUs"] = start
                        continue
                    if track.get("locked"):
                        raise VideoEditorValidationError("轨道已锁定", code="track_locked")
                    if clip["kind"] not in {"audio", "video"}:
                        raise VideoEditorValidationError("只有视频和音频 Clip 可以变速")
                    ratio = clip.get("playbackRate", 1) / data["playbackRate"]
                    duration = max(1, floor(clip["durationUs"] * ratio))
                    clip["timedEffects"] = scale_timed_effects(clip, ratio, duration)
                    for key in clip.get("keyframes", []):
                        key["timeUs"] = min(duration, round(key["timeUs"] * ratio))
                    for edge in ("transitionIn", "transitionOut"):
                        if clip.get(edge):
                            clip[edge]["durationUs"] = min(
                                duration, 10_000_000, round(clip[edge]["durationUs"] * ratio)
                            )
                    clip.update(durationUs=duration, playbackRate=data["playbackRate"])
        elif kind == "alignAudioSeam":
            align_audio_seam(result, data)
        elif kind == "setAudioTransition":
            set_audio_transition(result, data)
        elif kind == "restoreClipStates":
            for restored in data["clips"]:
                track, current = find_clip(result, restored["id"])
                if track.get("locked"):
                    raise VideoEditorValidationError("恢复片段的轨道已锁定", code="track_locked")
                if restored["trackId"] != track["id"]:
                    raise VideoEditorValidationError(
                        "恢复片段不能改变所属轨道", code="invalid_track_kind"
                    )
                current.clear()
                current.update(restored)
        elif kind == "splitClip":
            selected_track, selected_clip = find_clip(result, data["clipId"])
            group_id = selected_clip.get("linkGroupId")
            candidates = [(selected_track, selected_clip)]
            if group_id:
                candidates = [
                    (track, clip)
                    for track in result["tracks"]
                    for clip in track["clips"]
                    if clip.get("linkGroupId") == group_id
                    and clip["timelineStartUs"]
                    < data["atUs"]
                    < clip["timelineStartUs"] + clip["durationUs"]
                ]
            linked_ids = data.get("linkedNewClipIds") or {}
            right_group_id = data.get("newLinkGroupId") or f"right-{data['newClipId']}"
            if len(right_group_id) > 64:
                right_group_id = right_group_id[:64]
            for index, (track, clip) in enumerate(candidates):
                offset = data["atUs"] - clip["timelineStartUs"]
                if offset <= 0 or offset >= clip["durationUs"]:
                    raise VideoEditorValidationError(
                        "分割点必须位于 Clip 内部", code="invalid_split"
                    )
                new_id = (
                    data["newClipId"]
                    if clip["id"] == data["clipId"]
                    else linked_ids.get(clip["id"]) or f"{data['newClipId'][:48]}-{index}"
                )
                right = deepcopy(clip)
                right["timedEffects"] = crop_timed_effects(
                    clip, offset, clip["durationUs"] - offset
                )
                clip["timedEffects"] = crop_timed_effects(clip, 0, offset)
                right.update(
                    id=new_id,
                    timelineStartUs=data["atUs"],
                    durationUs=clip["durationUs"] - offset,
                    sourceInUs=clip.get("sourceInUs", 0)
                    + floor(offset * clip.get("playbackRate", 1)),
                )
                if group_id:
                    right["linkGroupId"] = right_group_id
                right.pop("transitionIn", None)
                clip.pop("transitionOut", None)
                clip["durationUs"] = offset
                track["clips"].append(right)
                for transition in _transitions(result):
                    if (
                        transition.get("fromClipId") == clip["id"]
                        and transition.get("placement", "between") == "between"
                    ):
                        transition["fromClipId"] = new_id
        elif kind in {"removeClip", "rippleDelete"}:
            track, removed = _remove_clip(result, data["clipId"])
            _remove_transitions_for_clip(result, removed["id"])
            if kind == "rippleDelete":
                end = removed["timelineStartUs"] + removed["durationUs"]
                for clip in track["clips"]:
                    if clip["timelineStartUs"] >= end:
                        clip["timelineStartUs"] -= removed["durationUs"]
        elif kind == "duplicateClip":
            track, clip = find_clip(result, data["clipId"])
            duplicate = deepcopy(clip)
            duplicate["id"] = data.get("newClipId") or f"{clip['id']}-copy"
            duplicate["timelineStartUs"] += clip["durationUs"]
            track["clips"].append(duplicate)
        elif kind == "linkClips":
            for clip_id in data["clipIds"]:
                _track, clip = find_clip(result, clip_id)
                clip["linkGroupId"] = data["linkGroupId"]
        elif kind == "separateClip":
            mixed_track, clip = find_clip(result, data["clipId"])
            if mixed_track["kind"] != "mixed" or clip["kind"] != "video":
                raise VideoEditorValidationError(
                    "只有混合轨中的视频 Clip 可以分离", code="invalid_separation"
                )
            visual = next(
                (item for item in result["tracks"] if item["id"] == data["visualTrackId"]),
                None,
            )
            audio = next(
                (item for item in result["tracks"] if item["id"] == data["audioTrackId"]),
                None,
            )
            if visual is None or audio is None:
                raise VideoEditorValidationError("分离目标轨道不存在", code="track_not_found")
            if visual["kind"] != "visual" or audio["kind"] != "audio":
                raise VideoEditorValidationError(
                    "分离目标轨道类型不正确", code="invalid_track_kind"
                )
            if visual.get("locked") or audio.get("locked"):
                raise VideoEditorValidationError("分离目标轨道已锁定", code="track_locked")
            end = clip["timelineStartUs"] + clip["durationUs"]
            if any(
                clip["timelineStartUs"] < other["timelineStartUs"] + other["durationUs"]
                and end > other["timelineStartUs"]
                for other in visual["clips"]
            ):
                raise VideoEditorValidationError(
                    "分离后视觉 Clip 与其他片段重叠", code="clip_overlap"
                )
            mixed_track["clips"].remove(clip)
            picture = deepcopy(clip)
            picture["trackId"] = visual["id"]
            picture.pop("muted", None)
            picture["muted"] = clip.get("muted", False)
            sound = deepcopy(clip)
            sound.pop("timedEffects", None)
            sound.update(
                id=data["audioClipId"],
                trackId=audio["id"],
                kind="audio",
                linkGroupId=None,
            )
            for edge in ("transitionIn", "transitionOut"):
                if sound.get(edge) and sound[edge].get("kind") != "audio-crossfade":
                    sound.pop(edge, None)
            visual["clips"].append(picture)
            audio["clips"].append(sound)
        elif kind == "unlinkClips":
            _track, clip = find_clip(result, data["clipId"])
            group_id = clip.pop("linkGroupId", None)
            if group_id:
                for track in result["tracks"]:
                    for peer in track["clips"]:
                        if peer.get("linkGroupId") == group_id:
                            peer.pop("linkGroupId", None)
        elif kind in {"addKeyframe", "updateKeyframe", "removeKeyframe"}:
            _track, clip = find_clip(result, data["clipId"])
            keyframes = clip.setdefault("keyframes", [])
            if kind == "addKeyframe":
                keyframes.append(data["keyframe"])
            else:
                key_id = data.get("keyframeId") or data.get("keyframe", {}).get("id")
                current = next((item for item in keyframes if item["id"] == key_id), None)
                if current is None:
                    raise VideoEditorValidationError("找不到关键帧", code="keyframe_not_found")
                if kind == "updateKeyframe":
                    current.update(data["keyframe"])
                else:
                    keyframes.remove(current)
        elif kind == "setTransition":
            _track, clip = find_clip(result, data["clipId"])
            key = "transitionIn" if data["edge"] == "in" else "transitionOut"
            if "transition" in data:
                clip[key] = data["transition"]
            else:
                clip.pop(key, None)
        elif kind == "addTransition":
            transitions = _transitions(result)
            transition = data["transition"]
            if transition.get("placement", "between") != "between":
                raise VideoEditorValidationError(
                    "独立转场只能用于接缝", code="invalid_transition_placement"
                )
            transition_id = transition["id"]
            if any(item["id"] == transition_id for item in transitions):
                raise VideoEditorValidationError("转场 ID 已存在", code="transition_exists")
            transition = {**transition, "placement": "between"}
            transitions.append(transition)
        elif kind == "updateTransition":
            transition = next(
                (item for item in _transitions(result) if item["id"] == data["transitionId"]),
                None,
            )
            if transition is None:
                raise VideoEditorValidationError("找不到指定转场", code="transition_not_found")
            allowed = {"kind", "durationUs", "direction", "easing"}
            transition.update(
                {key: value for key, value in data["patch"].items() if key in allowed}
            )
            transition["placement"] = "between"
        elif kind == "removeTransition":
            transitions = _transitions(result)
            before = len(transitions)
            transitions[:] = [item for item in transitions if item["id"] != data["transitionId"]]
            if len(transitions) == before:
                raise VideoEditorValidationError("找不到指定转场", code="transition_not_found")
    if any(
        operation.type
        in {
            "moveClip",
            "trimClip",
            "restoreClipStates",
        }
        for operation in body.operations
    ):
        _reconcile_audio_crossfades(result)
    return result
