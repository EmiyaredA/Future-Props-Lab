from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.video_editor.baking.bake_inputs import bake_effects
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.media import VideoEditorMedia
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import VideoEditorAssetBakeCreateIn, VideoEditorTaskOut
from studio.apps.video_editor.storage.models import VideoEditorTask
from studio.apps.video_editor.task_reads import task_out
from studio.config.settings import Settings


class VideoEditorAssetBakes:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, settings: Settings) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.media = VideoEditorMedia(session, owner_user_id, settings=settings)

    async def create(
        self, project_id: str, asset_id: str, body: VideoEditorAssetBakeCreateIn
    ) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        existing = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.owner_user_id == self.owner_user_id,
                    VideoEditorTask.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.kind != "asset_bake":
                raise VideoEditorValidationError(
                    "requestId 已被其他任务占用", code="request_conflict"
                )
            return task_out(existing)

        asset, metadata = await self.media.asset(project_id, asset_id)
        effects = bake_effects(project_id, asset, metadata, body)

        task = VideoEditorTask(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            request_id=body.request_id,
            kind="asset_bake",
            request_payload={
                "assetId": asset_id,
                "expectedRevision": body.expected_revision,
                "effects": effects.model_dump(mode="json", by_alias=True),
            },
            result_detail={"sourceAssetId": asset_id, "mediaKind": asset.media_kind},
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return task_out(task)

    async def get(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.owner_user_id == self.owner_user_id,
                    VideoEditorTask.kind == "asset_bake",
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("烘焙任务不存在")
        return task_out(row)
