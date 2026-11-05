"""Reserve, rename or delete a Video original under its scoped source receipt."""

from uuid import UUID

from sqlalchemy import delete, select

from studio.apps.asset_library.deletions import schedule
from studio.apps.asset_library.references.references import (
    protect_pending_removals,
    protect_references,
)
from studio.apps.asset_library.scoped_project_files import check_writable
from studio.apps.asset_library.storage.service_models import (
    PreparedAssetPin,
    ReferenceIntent,
    VideoFileWriteReceipt,
)
from studio.apps.asset_library.video.video_files import original_record
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.references import VideoFileRemoval, VideoFileRename


def command(change):
    if change.video_file_rename is not None:
        return {"video_file_rename": change.video_file_rename.model_dump(mode="json")}
    return {"video_file_removal": change.video_file_removal.model_dump(mode="json")}


async def _original(session, owner, project, asset):
    file = await original_record(session, owner, project, asset)
    if file is None:
        raise AssetError("剪辑项目素材不存在", code="not_found", status=404)
    return file


async def prepare(session, owner, row, change):
    removal = change.video_file_removal
    scope = removal or change.video_file_rename
    await check_writable(session, "video", scope.project_id)
    file = await _original(session, owner, scope.project_id, change.resource_id)
    if removal:
        if removal.render_id:
            receipt = await session.get(VideoFileWriteReceipt, (owner, UUID(removal.render_id).hex))
            if (
                receipt is None
                or receipt.project_id != scope.project_id
                or [item.get("id") for item in receipt.result] != [file.id]
            ):
                raise AssetError("成片原件回执不存在", code="not_found", status=404)
        await protect_references(session, [file.id])
    else:
        await protect_pending_removals(session, [file.id])
        pending = await session.scalar(
            select(ReferenceIntent.id)
            .where(ReferenceIntent.reference_set_id == row.id, ReferenceIntent.state == "prepared")
            .limit(1)
        )
        if pending is not None:
            raise AssetError("素材正在改名", code="reference_mutations_pending", status=409)
    return file.id


async def commit(session, owner, row, intent, revision, deleted):
    removing = row.resource_kind == "file-removal"
    if deleted != removing or revision != intent.expected_resource_revision + 1:
        raise AssetError("素材变更回执版本无效", code="invalid_resource_revision", status=422)
    if removing:
        scope = VideoFileRemoval.model_validate(intent.prepared_result["video_file_removal"])
        file = await _original(session, owner, scope.project_id, row.resource_id)
        await session.execute(
            delete(PreparedAssetPin).where(PreparedAssetPin.intent_id == intent.id)
        )
        await protect_references(session, [file.id])
        schedule(session, [file])
        await session.delete(file)
    else:
        scope = VideoFileRename.model_validate(intent.prepared_result["video_file_rename"])
        file = await _original(session, owner, scope.project_id, row.resource_id)
        # A display label does not change the original bytes or their version.
        file.display_name = scope.display_name
