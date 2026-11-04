"""Commit Video asset settings and a durable outcome for an original's new name."""

from uuid import uuid4

from sqlalchemy import text, update

from app.apps.video_editor.asset_output import asset_output
from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.timeline_file_removal import uses_file, without_file
from app.capabilities.asset_store.errors import AssetError
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.asset_references import PrepareReferenceChange, VideoFileRemoval, VideoFileRename
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.video_assets import PREFIX, VideoAsset

from .media_reads import MediaReads


class MediaEdits:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner
        self.coordinator = request.app.state.reference_mutations
        self.delivery = request.app.state.reference_delivery

    async def _metadata(self, project, original, expected):
        metadata = await self.session.get(
            VideoEditorAssetMetadata, original.id, populate_existing=True
        )
        if metadata is None or metadata.project_id != project:
            raise VideoEditorNotFoundError("素材不存在")
        if metadata.revision != expected:
            current = asset_output(project, original, metadata)
            raise RevisionConflictError(
                expected, current.revision, current.model_dump(mode="json", by_alias=True)
            )
        return metadata

    async def _prepare(self, change):
        try:
            return await self.coordinator.prepare(
                owner=self.owner,
                assertion=self.request.state.service_assertion,
                source_method=self.request.method,
                source_path=self.request.url.path,
                change=change,
            )
        except CapabilityDenied as exc:
            await self.coordinator.abandon_preparation(self.session, self.owner, change)
            if exc.status == 404:
                raise VideoEditorNotFoundError("素材不存在") from exc
            if exc.code == "asset_in_use":
                raise VideoEditorValidationError("素材仍被引用", code=exc.code) from exc
            if exc.status == 409:
                raise AssetError("素材变更正在同步", code=exc.code, status=409) from exc
            raise VideoEditorUnavailableError("素材暂不可更新") from exc
        except (CapabilityUnavailable, ProjectResourceError) as exc:
            await self.coordinator.abandon_preparation(self.session, self.owner, change)
            raise VideoEditorUnavailableError("素材暂不可更新") from exc

    async def patch(self, project, asset, body):
        await VideoEditorProjects(self.session, self.owner).row(project)
        await self.session.rollback()
        descriptor = await MediaReads(self.request, self.session, self.owner).read(
            f"{PREFIX}/{project}/files/{asset}/descriptor"
        )
        try:
            original = VideoAsset.model_validate(descriptor)
            if original.id != asset:
                raise ValueError("剪辑原件标识不匹配")
        except ValueError:
            raise VideoEditorUnavailableError("剪辑原件描述暂不可用") from None
        if (
            body.default_effects is not None
            and original.media_kind not in {"video", "image"}
            and body.default_effects.chroma_key is not None
        ):
            raise VideoEditorValidationError(
                "只有视频和图片素材可以设置抠像默认效果", code="invalid_kind"
            )
        await self._metadata(project, original, body.expected_revision)
        await self.session.rollback()
        prepared = None
        if body.display_name is not None:
            prepared = await self._prepare(
                PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="file-name",
                    resource_id=asset,
                    expected_resource_revision=body.expected_revision,
                    asset_ids=[],
                    video_file_rename=VideoFileRename(
                        project_id=project, display_name=body.display_name
                    ),
                )
            )

        async def apply():
            await self.session.execute(text("BEGIN IMMEDIATE"))
            metadata = await self._metadata(project, original, body.expected_revision)
            metadata.revision += 1
            metadata.updated_at = utc_now()
            if body.default_effects is not None:
                metadata.default_effects = body.default_effects.model_dump(
                    mode="json", by_alias=True
                )
            renamed = (
                original.model_copy(update={"display_name": body.display_name})
                if prepared
                else original
            )
            return asset_output(project, renamed, metadata)

        if prepared is None:
            result = await apply()
            await self.session.commit()
            return result
        result = await self.coordinator.commit_source(self.session, prepared, apply)
        await self._settle(prepared)
        return result

    async def _settle(self, prepared):
        try:
            await self.delivery.deliver(self.owner, prepared.request_id)
        except (CapabilityDenied, CapabilityUnavailable):
            raise VideoEditorUnavailableError("素材变更正在确认，请刷新素材列表") from None

    async def remove(self, project, asset, *, render_id=None, remove_task=None):
        await VideoEditorProjects(self.session, self.owner).row(project)
        row = await self.session.get(VideoEditorAssetMetadata, asset)
        if row is None or row.project_id != project:
            raise VideoEditorNotFoundError("素材不存在")
        timeline = await self.session.get(VideoEditorTimeline, project)
        if timeline is not None and uses_file(timeline.document, asset):
            raise VideoEditorValidationError("素材仍被时间轴引用", code="asset_in_use")
        expected = row.revision
        await self.session.rollback()
        prepared = await self._prepare(
            PrepareReferenceChange(
                request_id=uuid4().hex,
                resource_kind="file-removal",
                resource_id=asset,
                expected_resource_revision=expected,
                asset_ids=[],
                video_file_removal=VideoFileRemoval(project_id=project, render_id=render_id),
            )
        )
        try:
            await self.session.execute(text("BEGIN IMMEDIATE"))
            row = await self.session.get(VideoEditorAssetMetadata, asset)
            if row is None or row.project_id != project:
                raise VideoEditorNotFoundError("素材不存在")
            if row.revision != expected:
                raise AssetError("素材状态已更新，请重试删除", code="revision_conflict", status=409)
            if remove_task is not None:
                await remove_task()
            await self._remove_media(project, asset, row)
            await self.coordinator.record(
                self.session, prepared, resource_revision=expected + 1, deleted=True
            )
        except BaseException:
            await self.session.rollback()
            await self.coordinator.abort_after_rollback(self.session, prepared)
            raise
        await self.session.commit()
        await self._settle(prepared)

    async def _remove_media(self, project, asset, row):
        timeline = await self.session.get(VideoEditorTimeline, project)
        if timeline is not None:
            document = without_file(timeline.document, asset)
            if document is not None:
                timeline.document = document
                timeline.revision += 1
                timeline.updated_at = utc_now()
        await self.session.execute(
            update(VideoEditorTask)
            .where(VideoEditorTask.project_id == project, VideoEditorTask.output_asset_id == asset)
            .values(output_asset_id=None)
        )
        await self.session.execute(
            update(VideoEditorTask)
            .where(
                VideoEditorTask.project_id == project,
                VideoEditorTask.kind == "media",
                VideoEditorTask.request_payload["assetId"].as_string() == asset,
                VideoEditorTask.status.in_(("queued", "running")),
            )
            .values(
                status="failed",
                error="原件已删除",
                revision=VideoEditorTask.revision + 1,
                updated_at=utc_now(),
                finished_at=utc_now(),
            )
        )
        await self.session.delete(row)
