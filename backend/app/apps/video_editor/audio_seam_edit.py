"""Atomic, undoable placement of one music seam in a timeline document."""

from __future__ import annotations

from app.apps.video_editor.errors import VideoEditorValidationError


def audio_seam_pair(document: dict, from_id: str, to_id: str) -> tuple[dict, dict, dict]:
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
    ):
        raise VideoEditorValidationError(
            "请选择同一音频轨上相邻的两个音频片段", code="invalid_audio_seam"
        )
    if source.get("assetId") != target.get("assetId"):
        raise VideoEditorValidationError(
            "首版仅支持同一素材的音频接缝", code="different_audio_assets"
        )
    if source.get("sourceLoop") or target.get("sourceLoop"):
        raise VideoEditorValidationError("循环播放片段暂不支持相似接点", code="looped_audio_seam")
    if source.get("linkGroupId") or target.get("linkGroupId"):
        raise VideoEditorValidationError("请先分离与画面关联的音频片段", code="linked_audio_seam")
    if track.get("locked"):
        raise VideoEditorValidationError("音频轨已锁定", code="track_locked")
    return track, source, target


def align_audio_seam(document: dict, data: dict) -> None:
    track, source, target = audio_seam_pair(document, data["fromClipId"], data["toClipId"])
    fade = data["fadeDurationUs"]
    if target["durationUs"] <= fade or source["durationUs"] <= fade:
        raise VideoEditorValidationError(
            "候选点后可用音频不足以完成淡化", code="audio_seam_too_short"
        )
    new_start = source["timelineStartUs"] + source["durationUs"] - fade
    if new_start <= source["timelineStartUs"]:
        raise VideoEditorValidationError("淡化时长超过前一片段", code="audio_seam_too_short")
    delta = new_start - target["timelineStartUs"]
    following = {
        clip["id"]
        for clip in track["clips"]
        if clip["timelineStartUs"] > target["timelineStartUs"] and clip["id"] != target["id"]
    }
    linked_groups = {
        clip.get("linkGroupId")
        for clip in track["clips"]
        if clip["id"] in following and clip.get("linkGroupId")
    }
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
    target["sourceInUs"] = data["sourceInUs"]
    transitions = document.setdefault("transitions", [])
    existing = next(
        (
            transition
            for transition in transitions
            if transition.get("fromClipId") == source["id"]
            and transition.get("toClipId") == target["id"]
        ),
        None,
    )
    if existing is not None:
        if existing["kind"] != "audio-crossfade":
            raise VideoEditorValidationError("接缝已有其他转场", code="invalid_transition_kind")
        existing["durationUs"] = fade
    else:
        if any(item["id"] == data["transitionId"] for item in transitions):
            raise VideoEditorValidationError("转场 ID 已存在", code="transition_exists")
        transitions.append(
            {
                "id": data["transitionId"],
                "kind": "audio-crossfade",
                "durationUs": fade,
                "placement": "between",
                "fromClipId": source["id"],
                "toClipId": target["id"],
                "direction": "left",
                "easing": "linear",
            }
        )
