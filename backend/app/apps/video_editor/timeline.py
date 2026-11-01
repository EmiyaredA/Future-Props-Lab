from __future__ import annotations

from copy import deepcopy
from math import floor

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.audio_seam_edit import align_audio_seam
from app.apps.video_editor.audio_transition_edit import set_audio_transition
from app.apps.video_editor.clip_merging.document import replace_selection
from app.apps.video_editor.clip_merging.tasks import VideoEditorClipMerges
from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.schemas import (
    VideoEditorClip,
    VideoEditorTimelineBatchIn,
    VideoEditorTimelineDocument,
    VideoEditorTimelineOut,
)
from app.apps.video_editor.timed_effect_edit import crop_timed_effects, scale_timed_effects
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.media_rendering.audio_transitions import AUDIO_SEAM_KINDS
from app.capabilities.media_rendering.timeline_document import (
    normalize_legacy_edge_transitions,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now


def _find_clip(document: dict, clip_id: str) -> tuple[dict, dict]:
    for track in document["tracks"]:
        for clip in track["clips"]:
            if clip["id"] == clip_id:
                return track, clip
    raise VideoEditorValidationError("找不到指定 Clip", code="clip_not_found")


def _remove_clip(document: dict, clip_id: str) -> tuple[dict, dict]:
    track, clip = _find_clip(document, clip_id)
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
            _track, clip = _find_clip(result, data["clipId"])
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
            track, clip = _find_clip(result, data["clipId"])
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
            selected_track, selected = _find_clip(result, data["clipId"])
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
                track, current = _find_clip(result, restored["id"])
                if track.get("locked"):
                    raise VideoEditorValidationError("恢复片段的轨道已锁定", code="track_locked")
                if restored["trackId"] != track["id"]:
                    raise VideoEditorValidationError(
                        "恢复片段不能改变所属轨道", code="invalid_track_kind"
                    )
                current.clear()
                current.update(restored)
        elif kind == "splitClip":
            selected_track, selected_clip = _find_clip(result, data["clipId"])
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
            track, clip = _find_clip(result, data["clipId"])
            duplicate = deepcopy(clip)
            duplicate["id"] = data.get("newClipId") or f"{clip['id']}-copy"
            duplicate["timelineStartUs"] += clip["durationUs"]
            track["clips"].append(duplicate)
        elif kind == "linkClips":
            for clip_id in data["clipIds"]:
                _track, clip = _find_clip(result, clip_id)
                clip["linkGroupId"] = data["linkGroupId"]
        elif kind == "separateClip":
            mixed_track, clip = _find_clip(result, data["clipId"])
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
            _track, clip = _find_clip(result, data["clipId"])
            group_id = clip.pop("linkGroupId", None)
            if group_id:
                for track in result["tracks"]:
                    for peer in track["clips"]:
                        if peer.get("linkGroupId") == group_id:
                            peer.pop("linkGroupId", None)
        elif kind in {"addKeyframe", "updateKeyframe", "removeKeyframe"}:
            _track, clip = _find_clip(result, data["clipId"])
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
            _track, clip = _find_clip(result, data["clipId"])
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


async def validate_timeline(session: AsyncSession, project_id: str, document: dict) -> dict:
    document = normalize_legacy_edge_transitions(document)
    try:
        parsed = VideoEditorTimelineDocument.model_validate(document)
    except ValidationError as exc:
        message = exc.errors(include_input=False)[0]["msg"]
        raise VideoEditorValidationError(message, code="invalid_timeline") from exc
    dumped = parsed.model_dump(mode="json", by_alias=True, exclude_none=True)
    track_ids = [track["id"] for track in dumped["tracks"]]
    if len(track_ids) != len(set(track_ids)):
        raise VideoEditorValidationError("轨道 ID 必须全局唯一")
    track_orders = [track["order"] for track in dumped["tracks"]]
    if len(track_orders) != len(set(track_orders)):
        raise VideoEditorValidationError("轨道顺序必须唯一", code="duplicate_track_order")
    clip_ids: list[str] = []
    clips_by_id: dict[str, tuple[dict, dict]] = {}
    clip_asset_ids: set[str] = set()
    for track in dumped["tracks"]:
        track["clips"].sort(key=lambda clip: (clip["timelineStartUs"], clip["id"]))
        previous_end = 0
        for clip in track["clips"]:
            clip_ids.append(clip["id"])
            clips_by_id[clip["id"]] = (track, clip)
            if clip["trackId"] != track["id"]:
                raise VideoEditorValidationError("Clip 的 trackId 与所在轨道不一致")
            if track["kind"] == "audio" and clip["kind"] != "audio":
                raise VideoEditorValidationError("音频轨只能放置音频 Clip")
            if track["kind"] == "visual" and clip["kind"] == "audio":
                raise VideoEditorValidationError("视觉轨不能放置音频 Clip")
            if track["kind"] == "mixed" and clip["kind"] not in {"video", "image"}:
                raise VideoEditorValidationError("混合轨只能放置视频或图片 Clip")
            if track["kind"] in {"visual", "mixed"} and clip["timelineStartUs"] < previous_end:
                raise VideoEditorValidationError(
                    "同一视觉轨上的 Clip 不能重叠", code="clip_overlap"
                )
            previous_end = max(previous_end, clip["timelineStartUs"] + clip["durationUs"])
            for edge in ("transitionIn", "transitionOut"):
                transition = clip.get(edge)
                if transition and transition["durationUs"] > clip["durationUs"]:
                    raise VideoEditorValidationError("转场长度不能超过 Clip")
                if (
                    transition
                    and track["kind"] == "audio"
                    and transition.get("kind") != "audio-crossfade"
                ):
                    raise VideoEditorValidationError(
                        "音频轨片段转场只能使用 audio-crossfade",
                        code="invalid_transition_kind",
                    )
            for key in ("assetId", "fontAssetId"):
                if clip.get(key):
                    clip_asset_ids.add(clip[key])
    if len(clip_ids) != len(set(clip_ids)):
        raise VideoEditorValidationError("Clip ID 必须全局唯一")
    transition_ids: set[str] = set()
    transition_boundaries: set[tuple[str, str]] = set()
    for transition in dumped.get("transitions", []):
        if transition["id"] in transition_ids:
            raise VideoEditorValidationError("转场 ID 必须全局唯一", code="duplicate_transition_id")
        transition_ids.add(transition["id"])
        if transition.get("placement", "between") != "between":
            raise VideoEditorValidationError(
                "独立转场只能用于接缝", code="invalid_transition_placement"
            )
        from_clip = clips_by_id.get(transition.get("fromClipId"))
        to_clip = clips_by_id.get(transition.get("toClipId"))
        if not from_clip or not to_clip:
            raise VideoEditorValidationError("接缝转场引用无效", code="invalid_transition_ref")
        from_track, left = from_clip
        to_track, right = to_clip
        if transition["kind"] in AUDIO_SEAM_KINDS:
            if (
                from_track["id"] != to_track["id"]
                or from_track["kind"] != "audio"
                or left["kind"] != "audio"
                or right["kind"] != "audio"
            ):
                raise VideoEditorValidationError(
                    "音频接缝必须位于同一音频轨", code="invalid_transition_track"
                )
            ordered = sorted(
                from_track["clips"], key=lambda clip: (clip["timelineStartUs"], clip["id"])
            )
            left_index = next(
                (index for index, clip in enumerate(ordered) if clip["id"] == left["id"]),
                -1,
            )
            if (
                left_index < 0
                or left_index + 1 >= len(ordered)
                or ordered[left_index + 1]["id"] != right["id"]
            ):
                raise VideoEditorValidationError(
                    "音频接缝必须连接时间顺序相邻的片段",
                    code="transition_not_adjacent",
                )
            if left["timelineStartUs"] >= right["timelineStartUs"]:
                raise VideoEditorValidationError(
                    "音频交叉淡化需要前一片段先开始",
                    code="invalid_transition_order",
                )
            overlap_start = max(left["timelineStartUs"], right["timelineStartUs"])
            overlap_end = min(
                left["timelineStartUs"] + left["durationUs"],
                right["timelineStartUs"] + right["durationUs"],
            )
            if overlap_end <= overlap_start:
                raise VideoEditorValidationError(
                    "音频交叉淡化需要两个片段重叠",
                    code="transition_not_overlapping",
                )
            if transition["durationUs"] != overlap_end - overlap_start:
                raise VideoEditorValidationError(
                    "音频交叉淡化时长必须等于重叠区",
                    code="invalid_transition_duration",
                )
        elif from_track["id"] != to_track["id"] or from_track["kind"] not in {
            "visual",
            "mixed",
        }:
            raise VideoEditorValidationError(
                "接缝转场必须位于同一视觉轨", code="invalid_transition_track"
            )
        elif left["kind"] not in {"video", "image"} or right["kind"] not in {
            "video",
            "image",
        }:
            raise VideoEditorValidationError(
                "接缝转场必须绑定视觉 Clip", code="invalid_transition_track"
            )
        elif left["timelineStartUs"] + left["durationUs"] != right["timelineStartUs"]:
            raise VideoEditorValidationError(
                "接缝转场必须连接相邻 Clip", code="transition_not_adjacent"
            )
        boundary = (left["id"], right["id"])
        if boundary in transition_boundaries:
            raise VideoEditorValidationError(
                "同一接缝不能重复添加转场", code="duplicate_transition_edge"
            )
        transition_boundaries.add(boundary)
        if transition["kind"] not in AUDIO_SEAM_KINDS and transition["durationUs"] > min(
            left["durationUs"], right["durationUs"]
        ):
            raise VideoEditorValidationError(
                "转场长度不能超过相邻 Clip", code="transition_too_long"
            )
    organization = dumped.get("assetOrganization") or {}
    organized_asset_ids = set(organization.get("rootAssetIds") or [])
    for folder in organization.get("folders") or []:
        organized_asset_ids.update(folder.get("assetIds") or [])
    asset_ids = clip_asset_ids | organized_asset_ids
    if asset_ids:
        rows = (
            await session.execute(
                select(VisualAsset, VideoEditorAssetMetadata)
                .join(
                    VideoEditorAssetMetadata,
                    VideoEditorAssetMetadata.asset_id == VisualAsset.id,
                )
                .where(
                    VisualAsset.id.in_(asset_ids),
                    VisualAsset.video_editor_project_id == project_id,
                )
            )
        ).all()
        assets = {asset.id: (asset, metadata) for asset, metadata in rows}
        if set(assets) != asset_ids:
            raise VideoEditorValidationError(
                "时间轴或素材编排引用了不属于当前项目的素材", code="invalid_asset"
            )
        for track in dumped["tracks"]:
            for clip in track["clips"]:
                font_id = clip.get("fontAssetId")
                if font_id and assets[font_id][0].media_kind != "font":
                    raise VideoEditorValidationError(
                        "文字字体必须引用字体素材", code="invalid_asset_kind"
                    )
                asset_id = clip.get("assetId")
                if not asset_id:
                    continue
                asset, metadata = assets[asset_id]
                allowed = {
                    "video": {"video"},
                    "image": {"image"},
                    "audio": {"audio", "video"},
                }.get(clip["kind"], set())
                if asset.media_kind not in allowed:
                    raise VideoEditorValidationError(
                        "Clip 类型与素材类型不匹配", code="invalid_asset_kind"
                    )
                duration_us = int((metadata.probe or {}).get("durationUs") or 0)
                if (
                    duration_us
                    and not clip.get("sourceLoop")
                    and (
                        clip.get("sourceInUs", 0)
                        + floor(clip["durationUs"] * clip.get("playbackRate", 1))
                        > duration_us
                    )
                ):
                    raise VideoEditorValidationError(
                        "Clip 源区间超出素材时长", code="invalid_source_range"
                    )
    return dumped


class VideoEditorTimelines:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def row(self, project_id: str) -> VideoEditorTimeline:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = await self.session.get(VideoEditorTimeline, project_id)
        if row is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        return row

    @staticmethod
    def out(row: VideoEditorTimeline) -> VideoEditorTimelineOut:
        document = normalize_legacy_edge_transitions(deepcopy(row.document or {}))
        return VideoEditorTimelineOut(
            projectId=row.project_id,
            revision=row.revision,
            document=document,
            updatedAt=iso_utc(row.updated_at),
        )

    async def get(self, project_id: str) -> VideoEditorTimelineOut:
        return self.out(await self.row(project_id))

    async def apply(
        self, project_id: str, body: VideoEditorTimelineBatchIn
    ) -> VideoEditorTimelineOut:
        existing = (
            await self.session.execute(
                select(VideoEditorOperationBatch).where(
                    VideoEditorOperationBatch.project_id == project_id,
                    VideoEditorOperationBatch.owner_user_id == self.owner_user_id,
                    VideoEditorOperationBatch.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.base_revision != body.expected_revision or existing.operations != [
                op.model_dump(mode="json", by_alias=True, exclude_none=True)
                for op in body.operations
            ]:
                raise VideoEditorValidationError(
                    "requestId 已用于不同操作", code="request_id_reused"
                )
            return await self.get(project_id)
        row = await self.row(project_id)
        if row.revision != body.expected_revision:
            current = self.out(row)
            raise RevisionConflictError(
                body.expected_revision,
                row.revision,
                current.model_dump(mode="json", by_alias=True),
            )
        operations = [
            op.model_dump(mode="json", by_alias=True, exclude_none=True) for op in body.operations
        ]
        merge_contexts = await VideoEditorClipMerges(
            self.session, self.owner_user_id
        ).operation_contexts(project_id, body.operations)
        document = await validate_timeline(
            self.session, project_id, apply_operations(row.document, body, merge_contexts)
        )
        for operation in body.operations:
            if operation.type != "alignAudioSeam":
                continue
            _track, target = _find_clip(document, operation.to_clip_id)
            asset = await self.session.get(VisualAsset, target["assetId"])
            metadata = await self.session.get(VideoEditorAssetMetadata, target["assetId"])
            if (
                asset is None
                or asset.media_kind != "audio"
                or metadata is None
                or metadata.processing_status != "ready"
            ):
                raise VideoEditorValidationError("音频素材尚未准备好", code="audio_not_ready")
        now = utc_now()
        result = await self.session.execute(
            update(VideoEditorTimeline)
            .where(
                VideoEditorTimeline.project_id == project_id,
                VideoEditorTimeline.revision == body.expected_revision,
            )
            .values(document=document, revision=body.expected_revision + 1, updated_at=now)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.row(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                self.out(current).model_dump(mode="json", by_alias=True),
            )
        self.session.add(
            VideoEditorOperationBatch(
                owner_user_id=self.owner_user_id,
                project_id=project_id,
                request_id=body.request_id,
                base_revision=body.expected_revision,
                result_revision=body.expected_revision + 1,
                operations=operations,
            )
        )
        await self.session.execute(
            update(VideoEditorProject)
            .where(
                VideoEditorProject.id == project_id,
                VideoEditorProject.owner_user_id == self.owner_user_id,
            )
            .values(updated_at=now)
        )
        await self.session.commit()
        # The validated document is already the committed result. Returning it
        # avoids a second project/timeline read on every small edit such as a split.
        return VideoEditorTimelineOut(
            projectId=project_id,
            revision=body.expected_revision + 1,
            document=document,
            updatedAt=iso_utc(now),
        )
