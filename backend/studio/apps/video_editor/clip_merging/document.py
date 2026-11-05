from copy import deepcopy

from app.capabilities.media_rendering.timeline_document import (
    VideoEditorClip,
    parse_timeline_document,
)
from studio.apps.video_editor.errors import VideoEditorValidationError


def selection(document: dict, clip_ids: list[str]) -> dict:
    document = parse_timeline_document(deepcopy(document)).model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    ids = set(clip_ids)
    entries = [
        (track, clip)
        for track in document["tracks"]
        for clip in track["clips"]
        if clip["id"] in ids
    ]
    if not 2 <= len(ids) <= 100 or len(entries) != len(ids):
        raise VideoEditorValidationError(
            "请选择 2～100 个有效视频片段", code="invalid_merge_selection"
        )
    track = entries[0][0]
    clips = sorted((clip for _, clip in entries), key=lambda clip: clip["timelineStartUs"])
    if any(owner["id"] != track["id"] for owner, _ in entries):
        raise VideoEditorValidationError("只能合并同一轨道的片段", code="merge_cross_track")
    if track["kind"] not in {"visual", "mixed"} or any(clip["kind"] != "video" for clip in clips):
        raise VideoEditorValidationError("只能合并视频片段", code="merge_video_required")
    if track["locked"]:
        raise VideoEditorValidationError("轨道已锁定", code="track_locked")
    if any(clip.get("linkGroupId") for clip in clips):
        raise VideoEditorValidationError("请先解除片段的音画关联", code="merge_linked_clips")
    if any(
        left["timelineStartUs"] + left["durationUs"] != right["timelineStartUs"]
        for left, right in zip(clips, clips[1:], strict=False)
    ):
        raise VideoEditorValidationError(
            "请选择首尾连续、无间隙或重叠的视频片段", code="merge_not_contiguous"
        )
    start = clips[0]["timelineStartUs"]
    end = clips[-1]["timelineStartUs"] + clips[-1]["durationUs"]
    if any(
        clip["id"] not in ids
        and clip["timelineStartUs"] < end
        and clip["timelineStartUs"] + clip["durationUs"] > start
        for clip in track["clips"]
    ):
        raise VideoEditorValidationError(
            "所选范围包含未选中的片段", code="merge_incomplete_selection"
        )
    transitions = sorted(
        (
            item
            for item in document["transitions"]
            if ids.intersection((item["fromClipId"], item["toClipId"]))
        ),
        key=lambda item: item["id"],
    )
    neighbor_ids = {
        value for item in transitions for value in (item["fromClipId"], item["toClipId"])
    } - ids
    return {
        "settings": document["settings"],
        "track": {key: value for key, value in track.items() if key != "clips"},
        "clips": clips,
        "transitions": transitions,
        "neighbors": sorted(
            (
                clip
                for owner in document["tracks"]
                for clip in owner["clips"]
                if clip["id"] in neighbor_ids
            ),
            key=lambda clip: clip["id"],
        ),
        "startUs": start,
        "durationUs": end - start,
    }


def render_snapshot(document: dict, source: dict) -> dict:
    result = deepcopy(document)
    track = deepcopy(source["track"])
    track.update(clips=deepcopy(source["clips"]), hidden=False, muted=False, locked=False)
    result["tracks"] = [track]
    ids = {clip["id"] for clip in source["clips"]}
    result["transitions"] = [
        item for item in source["transitions"] if {item["fromClipId"], item["toClipId"]} <= ids
    ]
    return result


def merged_clip(source: dict, asset_id: str, name: str, clip_id: str) -> dict:
    return VideoEditorClip.model_validate(
        {
            "id": clip_id,
            "trackId": source["track"]["id"],
            "kind": "video",
            "name": name,
            "timelineStartUs": source["startUs"],
            "durationUs": source["durationUs"],
            "assetId": asset_id,
            "fitMode": "native",
        }
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


def replace_selection(document: dict, context: dict, clip_id: str, *, undo: bool) -> dict:
    result = parse_timeline_document(deepcopy(document)).model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    source = context["source"]
    ids = {clip["id"] for clip in source["clips"]}
    replacement = merged_clip(source, context["assetId"], context["name"], clip_id)
    track = next((item for item in result["tracks"] if item["id"] == source["track"]["id"]), None)
    external = [
        {**item, **{key: clip_id for key in ("fromClipId", "toClipId") if item[key] in ids}}
        for item in source["transitions"]
        if not {item["fromClipId"], item["toClipId"]} <= ids
    ]
    if not undo:
        if selection(result, list(ids)) != source:
            raise VideoEditorValidationError(
                "片段或相关设置已变更；合并素材已保留，请重新合并", code="merge_source_changed"
            )
        if any(clip["id"] == clip_id for owner in result["tracks"] for clip in owner["clips"]):
            raise VideoEditorValidationError("新片段 ID 已存在", code="duplicate_clip_id")
        assert track is not None
        track["clips"] = [clip for clip in track["clips"] if clip["id"] not in ids] + [replacement]
        touched = {item["id"] for item in source["transitions"]}
        result["transitions"] = [
            item for item in result["transitions"] if item["id"] not in touched
        ] + external
    else:
        current = next(
            (
                clip
                for owner in result["tracks"]
                for clip in owner["clips"]
                if clip["id"] == clip_id
            ),
            None,
        )
        actual_edges = sorted(
            (
                item
                for item in result["transitions"]
                if clip_id in (item["fromClipId"], item["toClipId"])
            ),
            key=lambda item: item["id"],
        )
        if track is None or track["locked"] or current != replacement or actual_edges != external:
            raise VideoEditorValidationError(
                "合并片段已变更，无法恢复原片段", code="merge_result_changed"
            )
        if any(clip["id"] in ids for owner in result["tracks"] for clip in owner["clips"]):
            raise VideoEditorValidationError("原片段 ID 已存在", code="duplicate_clip_id")
        track["clips"] = [clip for clip in track["clips"] if clip["id"] != clip_id] + deepcopy(
            source["clips"]
        )
        result["transitions"] = [
            item
            for item in result["transitions"]
            if clip_id not in (item["fromClipId"], item["toClipId"])
        ] + deepcopy(source["transitions"])
    return result
