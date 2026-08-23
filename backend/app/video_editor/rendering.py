from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.time import iso_utc, utc_now
from app.models import VideoEditorAssetMetadata, VideoEditorTask, VideoEditorTimeline
from app.schemas.video_editor import (
    VideoEditorRenderCreateIn,
    VideoEditorRenderIssue,
    VideoEditorRenderPreviewIn,
    VideoEditorRenderPreviewOut,
    VideoEditorTaskListOut,
    VideoEditorTaskOut,
    VideoEditorTimelineDocument,
)
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.evaluator import timeline_duration_us, visual_gaps
from app.video_editor.projects import VideoEditorProjects

PRESETS = {
    "720p30": (1280, 720, 30),
    "1080p30": (1920, 1080, 30),
    "720p60": (1280, 720, 60),
    "1080p60": (1920, 1080, 60),
}


def task_out(row: VideoEditorTask) -> VideoEditorTaskOut:
    return VideoEditorTaskOut(
        id=row.id,
        projectId=row.project_id,
        requestId=row.request_id,
        kind=row.kind,
        status=row.status,
        progress=row.progress,
        outputAssetId=row.output_asset_id,
        error=row.error,
        resultDetail=row.result_detail or {},
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
    )


class VideoEditorRenders:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _timeline(self, project_id: str) -> VideoEditorTimeline:
        await VideoEditorProjects(self.session).row(project_id)
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
        document = VideoEditorTimelineDocument.model_validate(timeline.document)
        total = timeline_duration_us(document)
        end = body.end_us or total
        blockers: list[VideoEditorRenderIssue] = []
        if end <= body.start_us or end > total:
            blockers.append(
                VideoEditorRenderIssue(code="invalid_range", message="导出范围超出时间轴")
            )
        asset_ids = {
            clip.asset_id for track in document.tracks for clip in track.clips if clip.asset_id
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
        fps = PRESETS[body.preset][2]
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

    async def create(self, project_id: str, body: VideoEditorRenderCreateIn) -> VideoEditorTaskOut:
        existing = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return task_out(existing)
        preview_body = VideoEditorRenderPreviewIn(
            expectedRevision=body.expected_revision,
            preset=body.preset,
            startUs=body.start_us,
            endUs=body.end_us,
        )
        preview = await self.preview(project_id, preview_body)
        if not preview.ready:
            raise VideoEditorValidationError("渲染预检未通过", code="render_not_ready")
        if preview.fingerprint != body.preview_fingerprint:
            raise VideoEditorValidationError("预检结果已过期", code="preview_stale")
        timeline = await self._timeline(project_id)
        task = VideoEditorTask(
            project_id=project_id,
            request_id=body.request_id,
            kind="render",
            request_payload=body.model_dump(mode="json", by_alias=True),
            snapshot_document=timeline.document,
            result_detail={
                "durationUs": preview.duration_us,
                "frameCount": preview.frame_count,
                "preset": body.preset,
                "fingerprint": preview.fingerprint,
            },
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return task_out(task)

    async def list(self, project_id: str) -> VideoEditorTaskListOut:
        await VideoEditorProjects(self.session).row(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VideoEditorTask)
                    .where(VideoEditorTask.project_id == project_id)
                    .order_by(VideoEditorTask.created_at.desc())
                )
            ).scalars()
        )
        return VideoEditorTaskListOut(items=[task_out(row) for row in rows])

    async def get(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("渲染任务不存在")
        return task_out(row)

    async def cancel(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("渲染任务不存在")
        if row.status in {"queued", "running"}:
            row.cancel_requested = True
            if row.status == "queued":
                row.status = "cancelled"
                row.progress = 0
            row.revision += 1
            row.updated_at = utc_now()
            await self.session.commit()
        return task_out(row)
