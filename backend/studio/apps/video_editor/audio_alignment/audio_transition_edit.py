"""Atomic placement and resizing of an audio-track seam transition."""

from __future__ import annotations

from studio.apps.media_rendering.local.audio_transitions import AUDIO_SEAM_KINDS
from studio.apps.video_editor.errors import VideoEditorValidationError


def audio_transition_pair(document: dict, from_id: str, to_id: str) -> tuple[dict, dict, dict]:
    entries = {
        clip["id"]: (track, clip)
        for track in document.get("tracks", [])
        for clip in track.get("clips", [])
    }
    left = entries.get(from_id)
    right = entries.get(to_id)
    if not left or not right:
        raise VideoEditorValidationError("找不到音频片段", code="clip_not_found")
    track, source = left
    target_track, target = right
    ordered = sorted(track["clips"], key=lambda clip: (clip["timelineStartUs"], clip["id"]))
    if (
        target_track["id"] != track["id"]
        or track["kind"] != "audio"
        or source["kind"] != "audio"
        or target["kind"] != "audio"
        or not any(
            ordered[index]["id"] == from_id and ordered[index + 1]["id"] == to_id
            for index in range(len(ordered) - 1)
        )
        or source["timelineStartUs"] >= target["timelineStartUs"]
    ):
        raise VideoEditorValidationError(
            "请选择同一音频轨上按时间相邻的两个片段", code="invalid_audio_seam"
        )
    if source.get("linkGroupId") or target.get("linkGroupId"):
        raise VideoEditorValidationError("请先分离与画面关联的音频片段", code="linked_audio_seam")
    if track.get("locked"):
        raise VideoEditorValidationError("音频轨已锁定", code="track_locked")
    if source["timelineStartUs"] + source["durationUs"] < target["timelineStartUs"]:
        raise VideoEditorValidationError("请先对齐两个音频片段", code="audio_seam_gap")
    return track, source, target


def set_audio_transition(document: dict, data: dict) -> None:
    track, source, target = audio_transition_pair(document, data["fromClipId"], data["toClipId"])
    if data["kind"] not in AUDIO_SEAM_KINDS:
        raise VideoEditorValidationError("不支持的音频转场", code="invalid_transition_kind")
    duration = data["durationUs"]
    if duration >= min(source["durationUs"], target["durationUs"]):
        raise VideoEditorValidationError("转场时长必须短于两段音频", code="transition_too_long")
    new_start = source["timelineStartUs"] + source["durationUs"] - duration
    if new_start <= source["timelineStartUs"]:
        raise VideoEditorValidationError("转场起点无效", code="invalid_transition_order")
    delta = new_start - target["timelineStartUs"]
    following = {
        clip["id"]
        for clip in track["clips"]
        if clip["id"] != target["id"] and clip["timelineStartUs"] > target["timelineStartUs"]
    }
    linked_groups = {
        clip.get("linkGroupId")
        for clip in track["clips"]
        if clip["id"] in following and clip.get("linkGroupId")
    }
    if delta:
        for other_track in document["tracks"]:
            for clip in other_track["clips"]:
                if clip["id"] not in following and clip.get("linkGroupId") not in linked_groups:
                    continue
                if other_track.get("locked"):
                    raise VideoEditorValidationError("后续片段的轨道已锁定", code="track_locked")
                if clip["timelineStartUs"] + delta < 0:
                    raise VideoEditorValidationError(
                        "后续片段不能移到时间轴起点之前", code="invalid_clip_start"
                    )
                clip["timelineStartUs"] += delta
    target["timelineStartUs"] = new_start
    transitions = document.setdefault("transitions", [])
    existing = next(
        (
            item
            for item in transitions
            if item.get("fromClipId") == source["id"] and item.get("toClipId") == target["id"]
        ),
        None,
    )
    if existing:
        if existing["id"] != data["transitionId"] or existing["kind"] not in AUDIO_SEAM_KINDS:
            raise VideoEditorValidationError("接缝已有其他转场", code="transition_exists")
        existing.update(kind=data["kind"], durationUs=duration, easing=data["easing"])
    else:
        if any(item["id"] == data["transitionId"] for item in transitions):
            raise VideoEditorValidationError("转场 ID 已存在", code="transition_exists")
        transitions.append(
            {
                "id": data["transitionId"],
                "kind": data["kind"],
                "durationUs": duration,
                "placement": "between",
                "fromClipId": source["id"],
                "toClipId": target["id"],
                "direction": "left",
                "easing": data["easing"],
            }
        )
