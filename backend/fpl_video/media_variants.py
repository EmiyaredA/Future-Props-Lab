"""Retry failed media and read only completed project derivative bindings."""

from sqlalchemy import select, text

from app.apps.video_editor.asset_output import asset_output
from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorUnavailableError
from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.apps.video_editor.projects import VideoEditorProjects
from app.runtime.ids import new_id
from app.runtime.time import utc_now
from fpl_runtime.video_assets import PREFIX, VideoAsset
from fpl_runtime.video_processing import VARIANTS

from .media_delivery import ACTIVE
from .media_reads import MediaReads
from .models import VideoMediaDispatch


async def retry(request, session, owner, project, asset):
    await VideoEditorProjects(session, owner).row(project)
    await session.rollback()
    descriptor = await MediaReads(request, session, owner).read(
        f"{PREFIX}/{project}/files/{asset}/descriptor"
    )
    try:
        original = VideoAsset.model_validate(descriptor)
    except ValueError:
        raise VideoEditorUnavailableError("原件描述暂不可用") from None
    if original.id != asset:
        raise VideoEditorUnavailableError("原件描述暂不可用")
    await session.execute(text("BEGIN IMMEDIATE"))
    metadata = await session.get(VideoEditorAssetMetadata, asset)
    if metadata is None or metadata.project_id != project:
        raise VideoEditorNotFoundError("素材不存在")
    pending = await session.scalar(
        select(VideoEditorTask.id)
        .join(VideoMediaDispatch, VideoEditorTask.id == VideoMediaDispatch.task_id)
        .where(
            VideoMediaDispatch.asset_id == asset,
            VideoMediaDispatch.project_id == project,
            VideoEditorTask.status.in_(ACTIVE),
        )
        .limit(1)
    )
    if pending is None:
        task_id = new_id()
        metadata.processing_status = "queued"
        metadata.error = None
        metadata.revision += 1
        metadata.updated_at = utc_now()
        session.add_all(
            (
                VideoEditorTask(
                    id=task_id,
                    owner_user_id=owner,
                    project_id=project,
                    kind="media",
                    request_id=f"media-retry-{task_id}",
                    request_payload={"assetId": asset},
                ),
                VideoMediaDispatch(
                    task_id=task_id, owner_user_id=owner, project_id=project, asset_id=asset
                ),
            )
        )
        await session.commit()
    return asset_output(project, original, metadata)


async def derivative(session, owner, project, asset, variant):
    if variant not in VARIANTS:
        raise VideoEditorNotFoundError("派生素材不存在")
    await VideoEditorProjects(session, owner).row(project)
    metadata = await session.get(VideoEditorAssetMetadata, asset)
    if metadata is None or metadata.project_id != project:
        raise VideoEditorNotFoundError("素材不存在")
    if not getattr(metadata, f"{variant}_filename"):
        raise VideoEditorNotFoundError("派生素材尚未生成")
    binding = await session.scalar(
        select(VideoMediaDispatch)
        .join(VideoEditorTask, VideoEditorTask.id == VideoMediaDispatch.task_id)
        .where(
            VideoMediaDispatch.asset_id == asset,
            VideoMediaDispatch.project_id == project,
            VideoEditorTask.status == "completed",
        )
        .order_by(VideoEditorTask.created_at.desc(), VideoEditorTask.id)
        .limit(1)
    )
    if binding is None:
        raise VideoEditorNotFoundError("派生素材文件不存在")
    session.expunge(binding)
    await session.rollback()
    return binding
