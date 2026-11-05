"""Resolve the frozen merge facts used by timeline edit operations."""

from sqlalchemy import select

from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTask


async def fingerprints(assets, project_id, source):
    ids = {clip["assetId"] for clip in source["clips"]}
    records = await assets.describe(project_id, ids)
    if set(records) != ids or any(
        entry.kind != "video" or entry.processing_status != "ready" for entry in records.values()
    ):
        raise VideoEditorValidationError("视频素材尚未准备好", code="asset_not_ready")
    return sorted(
        [identity, entry.fingerprint, entry.revision] for identity, entry in records.items()
    )


async def operation_contexts(session, owner, assets, project_id, operations):
    contexts = {}
    for operation in operations:
        if operation.type not in {"applyClipMerge", "undoClipMerge"}:
            continue
        row = await session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.id == operation.task_id,
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == owner,
                VideoEditorTask.kind == "clip_merge",
            )
        )
        if row is None:
            raise VideoEditorNotFoundError("合并任务不存在")
        asset_id = row.output_asset_id
        detail = row.result_detail
        metadata = await session.get(VideoEditorAssetMetadata, asset_id) if asset_id else None
        if (
            row.status != "completed"
            or metadata is None
            or metadata.project_id != project_id
            or metadata.processing_status != "ready"
        ):
            raise VideoEditorValidationError("合并视频尚未就绪", code="merge_not_ready")
        if (
            operation.type == "applyClipMerge"
            and await fingerprints(assets, project_id, detail["source"]) != detail["sourceAssets"]
        ):
            raise VideoEditorValidationError(
                "源素材已变更，请重新合并", code="merge_source_changed"
            )
        contexts[operation.task_id] = {**detail, "assetId": asset_id}
    return contexts
