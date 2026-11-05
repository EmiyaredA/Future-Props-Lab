"""Freeze an owned, versioned chroma bake in the existing rendering dispatch."""

from sqlalchemy import select, text

from app.capabilities.media_rendering.video_bake_document import bake_video_document
from studio.apps.video_editor.baking.bake_inputs import bake_effects
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.media_reads import MediaReads
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTask
from studio.apps.video_editor.storage.service_models import VideoRenderDispatch
from studio.apps.video_editor.task_reads import task_out
from studio.contracts.video_editor.video_exports import (
    ExportInput,
    VideoExportRequest,
    VideoImageBakeRequest,
)
from studio.runtime.ids import new_id


class BakeRequests:
    def __init__(self, request, session, owner):
        self.session, self.owner = session, owner
        self.media = MediaReads(request, session, owner)

    async def _existing(self, project, request_id):
        row = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.project_id == project,
                VideoEditorTask.owner_user_id == self.owner,
                VideoEditorTask.request_id == request_id,
            )
        )
        if row is not None and row.kind != "asset_bake":
            raise VideoEditorValidationError("requestId 已被其他任务占用", code="request_conflict")
        return row

    @staticmethod
    def _freeze(source, metadata, effects, task_id):
        stem = (
            "".join(
                char if char not in "/\\" and ord(char) >= 32 else "_"
                for char in source.display_name
            )
            .encode()[:200]
            .decode(errors="ignore")
        )
        label = f"{stem}-baked-{task_id[:8]}"
        chroma = effects.chroma_key
        try:
            original = ExportInput(id=source.id, sha256=metadata.fingerprint)
            if source.media_kind == "image":
                return VideoImageBakeRequest(
                    filename=label + ".png",
                    files=(original,),
                    image_bake=chroma.model_dump(mode="json", by_alias=True),
                )
            duration = max(1, int((metadata.probe or {}).get("durationUs") or 5_000_000))
            document = bake_video_document(
                source.id, source.display_name, duration, task_id, chroma
            )
            return VideoExportRequest(
                document=document.model_dump(mode="json", by_alias=True),
                preset="1080p30",
                start_us=0,
                end_us=duration,
                filename=label + ".mp4",
                files=(original,),
                video_bake=True,
            )
        except ValueError:
            raise VideoEditorValidationError(
                "烘焙源文件摘要或时长无效", code="asset_not_ready"
            ) from None

    async def create(self, project, asset, body):
        await VideoEditorProjects(self.session, self.owner).row(project)
        existing = await self._existing(project, body.request_id)
        if existing is not None:
            return task_out(existing)
        await self.session.rollback()
        source = await self.media.original(project, asset)
        await self.session.execute(text("BEGIN IMMEDIATE"))
        existing = await self._existing(project, body.request_id)
        if existing is not None:
            return task_out(existing)
        metadata = await self.session.get(VideoEditorAssetMetadata, asset)
        if metadata is None or metadata.project_id != project:
            raise VideoEditorNotFoundError("素材不存在")
        effects = bake_effects(project, source, metadata, body)
        task_id = new_id()
        frozen = self._freeze(source, metadata, effects, task_id)
        task = VideoEditorTask(
            id=task_id,
            owner_user_id=self.owner,
            project_id=project,
            request_id=body.request_id,
            kind="asset_bake",
            request_payload={
                "assetId": asset,
                "expectedRevision": body.expected_revision,
                "effects": effects.model_dump(mode="json", by_alias=True),
            },
            result_detail={"sourceAssetId": asset, "mediaKind": source.media_kind},
        )
        self.session.add_all(
            (
                task,
                VideoRenderDispatch(
                    task_id=task.id,
                    owner_user_id=self.owner,
                    project_id=project,
                    frozen=frozen.model_dump(mode="json"),
                ),
            )
        )
        await self.session.commit()
        return task_out(task)
