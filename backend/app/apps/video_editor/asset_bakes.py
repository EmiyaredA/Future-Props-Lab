from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.asset_output import asset_output
from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.media import VideoEditorMedia
from app.apps.video_editor.models import (
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.rendering import task_out
from app.apps.video_editor.schemas import (
    VideoEditorAssetBakeCreateIn,
    VideoEditorDefaultEffects,
    VideoEditorTaskOut,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


class VideoEditorAssetBakes:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.media = VideoEditorMedia(session, owner_user_id)

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
        if metadata.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                metadata.revision,
                asset_output(project_id, asset, metadata).model_dump(mode="json"),
            )
        if asset.media_kind not in {"video", "image"}:
            raise VideoEditorValidationError("只有视频和图片可以烘焙抠像", code="invalid_kind")
        if metadata.processing_status != "ready":
            raise VideoEditorValidationError("素材尚未处理完成", code="asset_not_ready")

        effects = body.effects or VideoEditorDefaultEffects.model_validate(
            metadata.default_effects or {}
        )
        if effects.chroma_key is None or not effects.chroma_key.enabled:
            raise VideoEditorValidationError("烘焙需要启用抠像参数", code="chroma_required")

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


async def insert_baked_asset_in_organization(
    session: AsyncSession,
    *,
    project_id: str,
    source_asset_id: str,
    output_asset_id: str,
) -> None:
    timeline = await session.get(VideoEditorTimeline, project_id)
    if timeline is None:
        return
    document = deepcopy(timeline.document or {})
    organization = document.get("assetOrganization") or {
        "folders": [],
        "rootAssetIds": [],
    }
    folders = organization.get("folders") or []
    root_asset_ids = list(organization.get("rootAssetIds") or [])
    placed = False

    def insert_after(ids: list[str]) -> list[str]:
        if output_asset_id in ids:
            return ids
        if source_asset_id in ids:
            index = ids.index(source_asset_id) + 1
            return [*ids[:index], output_asset_id, *ids[index:]]
        return [*ids, output_asset_id]

    for folder in folders:
        asset_ids = list(folder.get("assetIds") or [])
        if source_asset_id in asset_ids:
            folder["assetIds"] = insert_after(asset_ids)
            placed = True
            break
    if not placed:
        if source_asset_id not in root_asset_ids:
            root_asset_ids = [*root_asset_ids, source_asset_id]
        organization["rootAssetIds"] = insert_after(root_asset_ids)
    organization["folders"] = folders
    document["assetOrganization"] = organization
    expected = timeline.revision
    result = await session.execute(
        update(VideoEditorTimeline)
        .where(
            VideoEditorTimeline.project_id == project_id,
            VideoEditorTimeline.revision == expected,
        )
        .values(
            document=document,
            revision=expected + 1,
            updated_at=utc_now(),
        )
    )
    if result.rowcount != 1:
        # Organization placement is best-effort; bake output still succeeds.
        return
