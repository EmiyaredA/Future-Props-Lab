"""Settle the transferred Motion original and one timeline insertion atomically."""

import asyncio

from pydantic import ValidationError
from sqlalchemy import select, text, update

from app.capabilities.media_rendering.timeline_document import parse_timeline_document
from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.media_registration import register_media
from studio.apps.video_editor.motion_media import MotionMedia
from studio.apps.video_editor.motion_operations import motion_operations
from studio.apps.video_editor.project_layouts import ProjectLayouts
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import VideoEditorProjectCreateIn, VideoEditorTimelineBatchIn
from studio.apps.video_editor.storage.models import (
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTimeline,
)
from studio.apps.video_editor.storage.service_models import VideoMotionHandoff
from studio.apps.video_editor.timeline import apply_operations
from studio.contracts.video_editor.video_handoff import MotionHandoff
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class MotionHandoffs(PollingTaskRunner):
    runner_name = "video-motion-handoff"
    poll_interval_seconds = 2

    def __init__(self, sessions, client, peer):
        super().__init__()
        self.sessions, self.media = sessions, MotionMedia(client, peer)
        self.locks = tuple(asyncio.Lock() for _ in range(16))

    def lock(self, identity):
        return self.locks[int(identity[:2], 16) % len(self.locks)]

    async def recover(self):
        # Accepted handoffs are retried against the same Assets receipt.
        pass

    async def load(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            return await session.get(VideoMotionHandoff, identity)

    @staticmethod
    def receipt(row, path):
        if row is None:
            raise VideoEditorNotFoundError("特效交接不存在")
        if row.source_path != path:
            raise VideoEditorValidationError("同一交接标识不能更换内容", code="request_id_reused")
        if row.state == "failed":
            raise VideoEditorNotFoundError("特效成片或剪辑项目不存在")
        if row.state != "completed":
            raise VideoEditorUnavailableError("特效成片交接结果尚未确认")
        return {"projectId": row.project_id, "assetId": row.output_asset_id}

    async def reserve(self, request, owner, identity, project, source):
        intent = await self.load(owner, identity)
        if intent is not None:
            if intent.source_path != request.url.path:
                raise VideoEditorValidationError(
                    "同一交接标识不能更换内容", code="request_id_reused"
                )
            return intent
        descriptor = await self.media.prepare(owner, source)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            intent = VideoMotionHandoff(
                id=identity,
                owner_user_id=owner,
                project_id=project,
                source_path=request.url.path,
                payload=source.model_dump(mode="json"),
                output_descriptor=descriptor,
            )
            projects = VideoEditorProjects(session, owner)
            if source.new_title is not None:
                try:
                    body = VideoEditorProjectCreateIn(title=source.new_title)
                except ValidationError:
                    raise VideoEditorValidationError("剪辑项目名称无效") from None
                layouts = ProjectLayouts(request, session, owner, request.app)
                async with layouts.create_layout(project):
                    await projects.add_project(
                        VideoEditorProject(
                            id=project, owner_user_id=owner, title=body.title, status="draft"
                        )
                    )
                    session.add(intent)
            else:
                await session.execute(text("BEGIN IMMEDIATE"))
                await projects.row(project)
                session.add(intent)
                await session.commit()
            return intent

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = await session.scalar(
                select(VideoMotionHandoff)
                .where(VideoMotionHandoff.state == "pending")
                .order_by(VideoMotionHandoff.checked_at, VideoMotionHandoff.id)
                .limit(1)
            )
        if pending is None:
            return
        async with self.lock(pending.id):
            await self.process(pending.owner_user_id, pending.id)

    async def process(self, owner, identity):
        row = await self.load(owner, identity)
        if row is None or row.state != "pending":
            return row
        try:
            source = MotionHandoff.model_validate(row.payload)
            asset = await self.media.transfer(row, source)
            await self.settle(row, asset, source)
        except (VideoEditorNotFoundError, ValueError):
            await self.fail(row)
        finally:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(VideoMotionHandoff)
                    .where(VideoMotionHandoff.id == identity)
                    .values(checked_at=utc_now())
                )
                await session.commit()
        return await self.load(owner, identity)

    async def fail(self, row):
        async with self.sessions(info={"owner_user_id": row.owner_user_id}) as session:
            await session.execute(
                update(VideoMotionHandoff)
                .where(VideoMotionHandoff.id == row.id, VideoMotionHandoff.state == "pending")
                .values(state="failed", error="motion_transfer_rejected")
            )
            await session.commit()

    async def settle(self, intent, asset, source):
        owner, project = intent.owner_user_id, intent.project_id
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(VideoMotionHandoff, intent.id)
            if row is None or row.state != "pending":
                return
            target = await VideoEditorProjects(session, owner).row(project)
            timeline = await session.get(VideoEditorTimeline, project)
            if timeline is None:
                raise VideoEditorNotFoundError("剪辑时间轴不存在")
            request_id = f"motion-handoff-{row.id}"
            operations = motion_operations(
                parse_timeline_document(timeline.document).model_dump(mode="json", by_alias=True),
                asset_id=asset.id,
                filename=asset.original_filename,
                duration_us=source.duration_us,
                track_id=f"motion-{row.id}",
                clip_id=f"motion-clip-{row.id}",
            )
            request = VideoEditorTimelineBatchIn.model_validate(
                {
                    "expectedRevision": timeline.revision,
                    "requestId": request_id,
                    "operations": operations,
                }
            )
            modified = parse_timeline_document(
                apply_operations(timeline.document, request, {})
            ).model_dump(mode="json", by_alias=True, exclude_none=True)
            register_media(session, owner, project, asset.id)
            session.add(
                VideoEditorOperationBatch(
                    owner_user_id=owner,
                    project_id=project,
                    request_id=request_id,
                    base_revision=timeline.revision,
                    result_revision=timeline.revision + 1,
                    operations=[
                        operation.model_dump(mode="json", by_alias=True, exclude_none=True)
                        for operation in request.operations
                    ],
                )
            )
            now = utc_now()
            timeline.document, timeline.updated_at = modified, now
            timeline.revision += 1
            target.updated_at = now
            row.state, row.output_asset_id = "completed", asset.id
            await session.commit()
