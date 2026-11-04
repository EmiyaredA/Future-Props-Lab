"""Reserve the Video original while its new name is committed by the source."""

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from fpl_runtime.asset_references import VideoFileRename

from .models import ReferenceIntent
from .scoped_project_files import check_writable
from .video_files import original_record


async def prepare(session, owner, row, change):
    command = change.video_file_rename
    await check_writable(session, "video", command.project_id)
    file = await original_record(session, owner, command.project_id, change.resource_id)
    if file is None:
        raise AssetError("剪辑项目素材不存在", code="not_found", status=404)
    pending = await session.scalar(
        select(ReferenceIntent.id)
        .where(ReferenceIntent.reference_set_id == row.id, ReferenceIntent.state == "prepared")
        .limit(1)
    )
    if pending is not None:
        raise AssetError("素材正在改名", code="reference_mutations_pending", status=409)
    return file.id


async def commit(session, owner, row, intent, revision, deleted):
    if deleted or revision != intent.expected_resource_revision + 1:
        raise AssetError("素材改名回执版本无效", code="invalid_resource_revision", status=422)
    command = VideoFileRename.model_validate(intent.prepared_result["video_file_rename"])
    file = await original_record(session, owner, command.project_id, row.resource_id)
    if file is None:
        raise AssetError("剪辑项目素材不存在", code="not_found", status=404)
    # A display label does not change the original bytes or their version.
    file.display_name = command.display_name
