"""Read-only validation and canonical fingerprints for Video renders."""

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.media_rendering.presets import RENDER_PRESETS
from app.capabilities.media_rendering.timeline_ranges import timeline_duration_us, visual_gaps
from studio.apps.video_editor.errors import VideoEditorNotFoundError
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import (
    VideoEditorRenderIssue,
    VideoEditorRenderPreviewIn,
    VideoEditorRenderPreviewOut,
    parse_timeline_document,
)
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTimeline
from studio.runtime.revisions import RevisionConflictError


class VideoRenderPreflight:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def _timeline(self, project_id: str) -> VideoEditorTimeline:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = await self.session.get(VideoEditorTimeline, project_id)
        if row is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        return row

    async def _asset_fingerprints(self, project_id: str, document: dict) -> list[str]:
        asset_ids = {
            value
            for track in document.get("tracks", [])
            for clip in track.get("clips", [])
            for value in (clip.get("assetId"), clip.get("fontAssetId"))
            if value
        }
        if not asset_ids:
            return []
        rows = list(
            (
                await self.session.execute(
                    select(VideoEditorAssetMetadata).where(
                        VideoEditorAssetMetadata.project_id == project_id,
                        VideoEditorAssetMetadata.asset_id.in_(asset_ids),
                    )
                )
            ).scalars()
        )
        return sorted(f"{row.asset_id}:{row.fingerprint}:{row.revision}" for row in rows)

    async def preview(
        self, project_id: str, body: VideoEditorRenderPreviewIn
    ) -> VideoEditorRenderPreviewOut:
        timeline = await self._timeline(project_id)
        if timeline.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        document = parse_timeline_document(timeline.document)
        total = timeline_duration_us(document)
        end = body.end_us or total
        blockers: list[VideoEditorRenderIssue] = []
        if end <= body.start_us or end > total:
            blockers.append(
                VideoEditorRenderIssue(code="invalid_range", message="导出范围超出时间轴")
            )
        asset_ids = {
            identity
            for track in document.tracks
            for clip in track.clips
            for identity in (clip.asset_id, clip.font_asset_id)
            if identity
        }
        if asset_ids:
            rows = list(
                (
                    await self.session.execute(
                        select(VideoEditorAssetMetadata).where(
                            VideoEditorAssetMetadata.project_id == project_id,
                            VideoEditorAssetMetadata.asset_id.in_(asset_ids),
                        )
                    )
                ).scalars()
            )
            ready = {row.asset_id for row in rows if row.processing_status == "ready"}
            for asset_id in sorted(asset_ids - ready):
                blockers.append(
                    VideoEditorRenderIssue(
                        code="asset_not_ready", message=f"素材 {asset_id} 尚未处理完成"
                    )
                )
        warnings = [
            VideoEditorRenderIssue(
                code="visual_gap",
                message="该区间没有视觉 Clip，将显示项目底色",
                startUs=start,
                endUs=stop,
            )
            for start, stop in visual_gaps(document)
            if stop > body.start_us and start < end
        ]
        fingerprints = await self._asset_fingerprints(project_id, timeline.document)
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "revision": timeline.revision,
                    "document": timeline.document,
                    "assets": fingerprints,
                    "preset": body.preset,
                    "startUs": body.start_us,
                    "endUs": end,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        fps = RENDER_PRESETS[body.preset][2]
        duration = max(0, end - body.start_us)
        return VideoEditorRenderPreviewOut(
            ready=not blockers,
            revision=timeline.revision,
            preset=body.preset,
            durationUs=duration,
            frameCount=round(duration / 1_000_000 * fps),
            fingerprint=fingerprint,
            blockers=blockers,
            warnings=warnings,
        )
