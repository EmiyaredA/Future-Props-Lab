from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.time import iso_utc, utc_now
from app.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTimeline,
    VisualAsset,
)
from app.schemas.video_editor import (
    VideoEditorClip,
    VideoEditorTimelineBatchIn,
    VideoEditorTimelineDocument,
    VideoEditorTimelineOut,
)
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.projects import VideoEditorProjects


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


def apply_operations(document: dict, body: VideoEditorTimelineBatchIn) -> dict:
    result = deepcopy(document)
    for operation in body.operations:
        data = operation.model_dump(mode="json", by_alias=True, exclude_none=True)
        kind = data.pop("type")
        if kind == "updateSettings":
            allowed = {"fps", "backgroundColor"}
            result["settings"].update(
                {key: value for key, value in data["patch"].items() if key in allowed}
            )
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
            if (track["kind"] == "mixed" and clip_kind != "video") or (
                track["kind"] == "audio" and clip_kind != "audio"
            ) or (track["kind"] == "visual" and clip_kind == "audio"):
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
                "volume",
                "muted",
                "transform",
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
                (old_track["kind"] == "mixed" and target["kind"] != "mixed")
                or
                (target["kind"] == "mixed" and clip["kind"] != "video")
                or (target["kind"] == "audio" and clip["kind"] != "audio")
                or (target["kind"] == "visual" and clip["kind"] == "audio")
            ):
                old_track["clips"].append(clip)
                raise VideoEditorValidationError("Clip 类型与轨道不匹配", code="invalid_track_kind")
            clip.update(trackId=data["trackId"], timelineStartUs=data["timelineStartUs"])
            target["clips"].append(clip)
        elif kind == "trimClip":
            _track, clip = _find_clip(result, data["clipId"])
            clip.update(
                timelineStartUs=data["timelineStartUs"],
                durationUs=data["durationUs"],
                sourceInUs=data["sourceInUs"],
            )
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
                right.update(
                    id=new_id,
                    timelineStartUs=data["atUs"],
                    durationUs=clip["durationUs"] - offset,
                    sourceInUs=clip.get("sourceInUs", 0) + offset,
                )
                if group_id:
                    right["linkGroupId"] = right_group_id
                clip["durationUs"] = offset
                track["clips"].append(right)
        elif kind in {"removeClip", "rippleDelete"}:
            track, removed = _remove_clip(result, data["clipId"])
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
            sound.update(
                id=data["audioClipId"],
                trackId=audio["id"],
                kind="audio",
                linkGroupId=None,
            )
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
    return result


async def validate_timeline(session: AsyncSession, project_id: str, document: dict) -> dict:
    parsed = VideoEditorTimelineDocument.model_validate(document)
    dumped = parsed.model_dump(mode="json", by_alias=True, exclude_none=True)
    track_ids = [track["id"] for track in dumped["tracks"]]
    if len(track_ids) != len(set(track_ids)):
        raise VideoEditorValidationError("轨道 ID 必须全局唯一")
    track_orders = [track["order"] for track in dumped["tracks"]]
    if len(track_orders) != len(set(track_orders)):
        raise VideoEditorValidationError("轨道顺序必须唯一", code="duplicate_track_order")
    clip_ids: list[str] = []
    asset_ids: set[str] = set()
    for track in dumped["tracks"]:
        track["clips"].sort(key=lambda clip: (clip["timelineStartUs"], clip["id"]))
        previous_end = 0
        for clip in track["clips"]:
            clip_ids.append(clip["id"])
            if clip["trackId"] != track["id"]:
                raise VideoEditorValidationError("Clip 的 trackId 与所在轨道不一致")
            if track["kind"] == "audio" and clip["kind"] != "audio":
                raise VideoEditorValidationError("音频轨只能放置音频 Clip")
            if track["kind"] == "visual" and clip["kind"] == "audio":
                raise VideoEditorValidationError("视觉轨不能放置音频 Clip")
            if track["kind"] == "mixed" and clip["kind"] != "video":
                raise VideoEditorValidationError("混合轨只能放置视频 Clip")
            if track["kind"] in {"visual", "mixed"} and clip["timelineStartUs"] < previous_end:
                raise VideoEditorValidationError(
                    "同一视觉轨上的 Clip 不能重叠", code="clip_overlap"
                )
            previous_end = max(previous_end, clip["timelineStartUs"] + clip["durationUs"])
            for edge in ("transitionIn", "transitionOut"):
                transition = clip.get(edge)
                if transition and transition["durationUs"] > clip["durationUs"]:
                    raise VideoEditorValidationError("转场长度不能超过 Clip")
            for key in ("assetId", "fontAssetId"):
                if clip.get(key):
                    asset_ids.add(clip[key])
    if len(clip_ids) != len(set(clip_ids)):
        raise VideoEditorValidationError("Clip ID 必须全局唯一")
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
                "时间轴引用了不属于当前项目的素材", code="invalid_asset"
            )
        for track in dumped["tracks"]:
            for clip in track["clips"]:
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
                if duration_us and clip.get("sourceInUs", 0) + clip["durationUs"] > duration_us:
                    raise VideoEditorValidationError(
                        "Clip 源区间超出素材时长", code="invalid_source_range"
                    )
    return dumped


class VideoEditorTimelines:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id

    async def row(self, project_id: str) -> VideoEditorTimeline:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        row = await self.session.get(VideoEditorTimeline, project_id)
        if row is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        return row

    @staticmethod
    def out(row: VideoEditorTimeline) -> VideoEditorTimelineOut:
        return VideoEditorTimelineOut(
            projectId=row.project_id,
            revision=row.revision,
            document=row.document,
            updatedAt=iso_utc(row.updated_at),
        )

    async def get(self, project_id: str) -> VideoEditorTimelineOut:
        return self.out(await self.row(project_id))

    async def apply(
        self, project_id: str, body: VideoEditorTimelineBatchIn
    ) -> VideoEditorTimelineOut:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        existing = (
            await self.session.execute(
                select(VideoEditorOperationBatch).where(
                    VideoEditorOperationBatch.project_id == project_id,
                    VideoEditorOperationBatch.workspace_id == self.workspace_id,
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
        document = await validate_timeline(
            self.session, project_id, apply_operations(row.document, body)
        )
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
                workspace_id=self.workspace_id,
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
                VideoEditorProject.workspace_id == self.workspace_id,
            )
            .values(updated_at=now)
        )
        await self.session.commit()
        return await self.get(project_id)
