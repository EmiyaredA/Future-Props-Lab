from __future__ import annotations

from math import floor

from pydantic import ValidationError

from studio.apps.media_rendering.local.audio_transitions import AUDIO_SEAM_KINDS
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.schemas import (
    VideoEditorTimelineDocument,
)
from studio.contracts.video_editor.timeline_document import normalize_legacy_edge_transitions


def validate_timeline(document: dict) -> dict:
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
    return dumped


def timeline_asset_ids(document: dict) -> set[str]:
    result = {
        value
        for track in document.get("tracks", [])
        for clip in track.get("clips", [])
        for value in (clip.get("assetId"), clip.get("fontAssetId"))
        if value
    }
    organization = document.get("assetOrganization") or {}
    result.update(organization.get("rootAssetIds") or [])
    for folder in organization.get("folders") or []:
        result.update(folder.get("assetIds") or [])
    return result


def validate_asset_facts(dumped: dict, records: dict) -> dict:
    asset_ids = timeline_asset_ids(dumped)
    if asset_ids:
        if set(records) != asset_ids:
            raise VideoEditorValidationError(
                "时间轴或素材编排引用了不属于当前项目的素材", code="invalid_asset"
            )
        for track in dumped["tracks"]:
            for clip in track["clips"]:
                font_id = clip.get("fontAssetId")
                if font_id and records[font_id].kind != "font":
                    raise VideoEditorValidationError(
                        "文字字体必须引用字体素材", code="invalid_asset_kind"
                    )
                asset_id = clip.get("assetId")
                if not asset_id:
                    continue
                asset = records[asset_id]
                allowed = {
                    "video": {"video"},
                    "image": {"image"},
                    "audio": {"audio", "video"},
                }.get(clip["kind"], set())
                if asset.kind not in allowed:
                    raise VideoEditorValidationError(
                        "Clip 类型与素材类型不匹配", code="invalid_asset_kind"
                    )
                duration_us = asset.duration_us
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
