from sqlalchemy import select

from app.apps.thought_workshop.multitable.storage import asset_ids, snapshot
from app.apps.thought_workshop.schemas.document import file_ids
from app.apps.thought_workshop.schemas.workshop import ThoughtAttachmentOut
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import ATTACHMENT_EXTENSIONS
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.asset_store.thumbnails import ThumbnailSize, ThumbnailSource, asset_thumbnail
from app.runtime.config import get_settings

from .access import article, bind_source, missing, publication
from .catalog import visible
from .models import CommunityUpload
from .mutations import begin_write


async def content(
    session,
    principal,
    pub_id,
    asset_id,
    note_id=None,
    cover=False,
    size: ThumbnailSize | None = None,
):
    pub = await publication(session, pub_id)
    if note_id:
        _, n, role = await article(session, principal, pub, note_id)
        allowed = file_ids(n.document)
        if n.kind == "multitable":
            allowed |= asset_ids(await snapshot(session, n.id))
        if role in {"edit", "manage"}:
            allowed |= set(
                await session.scalars(
                    select(CommunityUpload.asset_id).where(
                        CommunityUpload.note_id == note_id,
                        CommunityUpload.user_id == principal.user_id,
                    )
                )
            )
    else:
        rows, manager = await visible(session, principal, pub, include_content=not cover)
        if not rows and not manager:
            raise missing()
        allowed = (
            {pub.cover_asset_id} if cover else {a for n, _, _ in rows for a in file_ids(n.document)}
        )
    if asset_id not in allowed:
        raise missing()
    bind_source(session, pub)
    row = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id, VisualAsset.owner_user_id == pub.owner_user_id
        )
    )
    if row is None:
        raise missing()
    path = AssetStorage(get_settings()).path_for(row)
    if not path.is_file():
        raise missing()
    if size is not None and row.mime_type != "image/svg+xml":
        info = ThumbnailSource(
            row.id, row.revision, row.owner_user_id, row.media_kind, row.mime_type
        )
        await session.rollback()
        path = await asset_thumbnail(get_settings(), info, path, size)
        return "image/webp", path
    return row.mime_type, path


async def upload(session, principal, pub_id, note_id, incoming: IncomingFile):
    pub = await publication(session, pub_id)
    await article(session, principal, pub, note_id, level="edit")
    bind_source(session, pub)
    owner_user_id = pub.owner_user_id
    # No write transaction is held during file validation and storage.
    await session.rollback()
    row = await AssetLibrary(session, get_settings()).store_upload(
        incoming,
        owner_user_id=owner_user_id,
        allowed_extensions=ATTACHMENT_EXTENSIONS | {".png", ".jpg", ".jpeg", ".webp", ".gif"},
    )
    result = ThoughtAttachmentOut(
        asset_id=row.id,
        filename=row.original_filename,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
    )
    await begin_write(session)
    pub = await publication(session, pub_id)
    await article(session, principal, pub, note_id, level="edit")
    session.add(
        CommunityUpload(note_id=note_id, asset_id=result.asset_id, user_id=principal.user_id)
    )
    await session.commit()
    return result
