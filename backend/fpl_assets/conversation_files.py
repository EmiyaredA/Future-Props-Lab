"""Return only exact attachment metadata in an owned conversation projection."""

import base64

from anyio.to_thread import run_sync
from sqlalchemy import or_, select

from app.capabilities.asset_store.assistant_media import (
    ALLOWED_IMAGE_TYPES,
    ALLOWED_MEDIA_KINDS,
    MAX_IMAGE_BYTES,
    AssistantAssetError,
    read_document,
    read_image,
)
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.visual_assistant import AttachmentContext, AttachmentImage, AttachmentInput

from .models import (
    AssetReferencePin,
    AssetReferenceSet,
    PreparedAssetPin,
    ReferenceIntent,
    VisualProjectFileLink,
)
from .scoped_project_files import check_project_scope
from .visual_snapshot_files import scoped_assets


async def attachments(session, project_id, conversation_id, asset_ids):
    owner = session.info["owner_user_id"]
    projection = select(AssetReferenceSet.id).where(
        AssetReferenceSet.owner_user_id == owner,
        AssetReferenceSet.service_id == "visual",
        AssetReferenceSet.resource_kind == "conversation",
        AssetReferenceSet.resource_id == conversation_id,
        or_(
            AssetReferenceSet.scope_project_id == project_id,
            AssetReferenceSet.scope_project_id.is_(None),
        ),
        AssetReferenceSet.deleted.is_(False),
    )
    committed = select(AssetReferencePin.asset_id).where(
        AssetReferencePin.reference_set_id.in_(projection)
    )
    pending = (
        select(PreparedAssetPin.asset_id)
        .join(ReferenceIntent, ReferenceIntent.id == PreparedAssetPin.intent_id)
        .where(
            ReferenceIntent.reference_set_id.in_(projection),
            ReferenceIntent.state == "prepared",
        )
    )
    return list(
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.id.in_(asset_ids),
                VisualAsset.id.in_(committed.union(pending)),
                or_(
                    VisualAsset.project_id == project_id,
                    VisualAsset.project_id.is_(None)
                    & VisualAsset.galgame_project_id.is_(None)
                    & VisualAsset.video_editor_project_id.is_(None)
                    & VisualAsset.motion_compositor_project_id.is_(None),
                ),
            )
            .order_by(VisualAsset.id)
        )
    )


async def validate_retained_attachments(session, reference_set, project_id, requested):
    pinned = set(
        await session.scalars(
            select(AssetReferencePin.asset_id).where(
                AssetReferencePin.reference_set_id == reference_set.id
            )
        )
    )
    if not pinned <= requested:
        raise AssetError(
            "不能移除历史对话的引用", code="conversation_retention_changed", status=409
        )
    candidates = await scoped_assets(
        session, project_id, requested - pinned, include_private=False, include_pinned=False
    )
    return pinned | {row.id for row, _link in candidates}


async def attachment_inputs(state, owner, project, conversation, identities):
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        await check_project_scope(session, "visual", project)
        rows = await attachments(session, project, conversation, identities)
        if [row.id for row in rows] != identities:
            raise AssetError("附件不存在或不属于当前项目", code="scope_mismatch", status=422)
        session.expunge_all()
    storage = AssetStorage(state.settings)
    return [await run_sync(project_input, storage, row) for row in rows]


def project_input(storage, asset):
    if asset.media_kind not in ALLOWED_MEDIA_KINDS:
        raise AssetError("不支持此附件类型", code="invalid_asset", status=422)
    maximum = (
        MAX_IMAGE_BYTES
        if asset.media_kind == "image"
        else storage.settings.fpl_visual_asset_max_bytes
    )
    if asset.byte_size > maximum:
        message = "图片不能超过 8MB" if asset.media_kind == "image" else "附件超过项目文件大小限制"
        raise AssetError(message, code="file_too_large", status=413)
    metadata = AttachmentInput.model_validate(asset, from_attributes=True)
    path = storage.path_for(asset)
    if path.is_symlink():
        raise AssetError("附件原件不可用", code="file_missing", status=409)
    if asset.media_kind == "image" and asset.mime_type in ALLOWED_IMAGE_TYPES:
        try:
            content, mime_type = read_image(path, asset.mime_type, asset.display_name)
        except AssistantAssetError as exc:
            raise AssetError(str(exc), code=exc.code, status=exc.status) from exc
        return metadata.model_copy(
            update={
                "image": AttachmentImage(
                    mime_type=mime_type,
                    data_base64=base64.b64encode(content).decode("ascii"),
                    byte_size=len(content),
                )
            }
        )
    if asset.media_kind == "document":
        body, warning = read_document(path, asset.mime_type, asset.display_name)
        return metadata.model_copy(update={"text": body, "warning": warning})
    return metadata


async def canvas_attachment_context(database, owner, project, identities):
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await check_project_scope(session, "visual", project)
        rows = await scoped_assets(session, project, identities, include_private=False)
        return [AttachmentContext.model_validate(row, from_attributes=True) for row, _link in rows]


async def search_canvas_assets(database, owner, project, search):
    link = VisualProjectFileLink
    links = select(link.asset_id).where(link.owner_user_id == owner, link.project_id == project)
    statement = select(VisualAsset).where(
        VisualAsset.owner_user_id == owner,
        or_(
            VisualAsset.project_id == project,
            VisualAsset.project_id.is_(None)
            & VisualAsset.galgame_project_id.is_(None)
            & VisualAsset.video_editor_project_id.is_(None)
            & VisualAsset.motion_compositor_project_id.is_(None)
            & VisualAsset.id.in_(links),
        ),
    )
    if search.kind:
        statement = statement.where(VisualAsset.media_kind == search.kind)
    if search.query:
        statement = statement.where(
            VisualAsset.display_name.contains(search.query, autoescape=True)
        )
    statement = statement.order_by(VisualAsset.updated_at.desc(), VisualAsset.id)
    statement = statement.limit(search.limit)
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await check_project_scope(session, "visual", project)
        rows = await session.scalars(statement)
        return [AttachmentContext.model_validate(row) for row in rows]
