from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.clip_merging.document import selection
from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.rendering import task_out
from app.apps.video_editor.schemas import VideoEditorTaskListOut, VideoEditorTaskOut
from app.apps.video_editor.schemas.clip_merge import VideoEditorClipMergeCreateIn
from app.capabilities.asset_store.models import VisualAsset
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


class VideoEditorClipMerges:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def row(self, project_id: str, task_id: str) -> VideoEditorTask:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.id == task_id,
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.kind == "clip_merge",
            )
        )
        if row is None:
            raise VideoEditorNotFoundError("片段合并任务不存在")
        return row

    async def create(
        self, project_id: str, body: VideoEditorClipMergeCreateIn
    ) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.request_id == body.request_id,
            )
        )
        if existing:
            if existing.kind != "clip_merge" or existing.request_payload != payload:
                raise VideoEditorValidationError(
                    "requestId 已用于不同任务", code="request_id_reused"
                )
            return task_out(existing)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        if timeline is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        if timeline.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                timeline.revision,
                {
                    "revision": timeline.revision,
                    "document": timeline.document,
                },
            )
        source = selection(timeline.document, body.clip_ids)
        fingerprints = await self.asset_fingerprints(project_id, source)
        task = VideoEditorTask(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            request_id=body.request_id,
            kind="clip_merge",
            request_payload=payload,
            snapshot_document=timeline.document,
            result_detail={"source": source, "sourceAssets": fingerprints, "name": body.name},
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return task_out(task)

    async def asset_fingerprints(self, project_id: str, source: dict) -> list[list]:
        ids = {clip["assetId"] for clip in source["clips"]}
        rows = (
            await self.session.execute(
                select(VisualAsset, VideoEditorAssetMetadata)
                .join(
                    VideoEditorAssetMetadata,
                    VideoEditorAssetMetadata.asset_id == VisualAsset.id,
                )
                .where(
                    VisualAsset.id.in_(ids),
                    VisualAsset.video_editor_project_id == project_id,
                    VisualAsset.owner_user_id == self.owner_user_id,
                    VideoEditorAssetMetadata.project_id == project_id,
                )
            )
        ).all()
        if {asset.id for asset, _ in rows} != ids or any(
            asset.media_kind != "video" or metadata.processing_status != "ready"
            for asset, metadata in rows
        ):
            raise VideoEditorValidationError("视频素材尚未准备好", code="asset_not_ready")
        return sorted(
            [asset.id, metadata.fingerprint, metadata.revision] for asset, metadata in rows
        )

    async def get(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        return task_out(await self.row(project_id, task_id))

    async def list(self, project_id: str) -> VideoEditorTaskListOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        rows = await self.session.scalars(
            select(VideoEditorTask)
            .where(
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.kind == "clip_merge",
            )
            .order_by(VideoEditorTask.created_at.desc())
        )
        return VideoEditorTaskListOut(items=[task_out(row) for row in rows])

    async def cancel(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        row = await self.row(project_id, task_id)
        if row.status in {"queued", "running"}:
            row.cancel_requested = True
            if row.status == "queued":
                row.status = "cancelled"
            row.revision += 1
            row.updated_at = utc_now()
            await self.session.commit()
        return task_out(row)

    async def operation_contexts(self, project_id: str, operations: list) -> dict[str, dict]:
        contexts = {}
        for operation in operations:
            if operation.type not in {"applyClipMerge", "undoClipMerge"}:
                continue
            row = await self.row(project_id, operation.task_id)
            metadata = (
                await self.session.get(VideoEditorAssetMetadata, row.output_asset_id)
                if row.output_asset_id
                else None
            )
            if (
                row.status != "completed"
                or metadata is None
                or metadata.project_id != project_id
                or metadata.processing_status != "ready"
            ):
                raise VideoEditorValidationError("合并视频尚未就绪", code="merge_not_ready")
            detail = row.result_detail
            if (
                operation.type == "applyClipMerge"
                and await self.asset_fingerprints(project_id, detail["source"])
                != detail["sourceAssets"]
            ):
                raise VideoEditorValidationError(
                    "源素材已变更，请重新合并", code="merge_source_changed"
                )
            contexts[row.id] = {**detail, "assetId": row.output_asset_id}
        return contexts
