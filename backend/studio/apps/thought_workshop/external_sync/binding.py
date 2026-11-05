"""Bind a Thought document through an explicitly supplied connection owner."""

from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError

from app.integrations.external.contracts import ExternalError
from studio.apps.thought_workshop.external_sync.models import ArticleSyncBinding
from studio.apps.thought_workshop.external_sync.records import binding_out
from studio.runtime.revisions import RevisionConflictError


async def bind_note(records, connections, note_id, body):
    note = await records.note(note_id)
    current = await records.binding(note_id)
    if current and current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision,
            current.revision,
            binding_out(current).model_dump(mode="json"),
        )
    if not current and body.expected_revision != 0:
        raise ExternalError("绑定已变化，请刷新", 409)
    if current:
        await records.idle(current.target_key)
    note_revision = note.revision
    current_id = current.id if current else None
    connection_revision = (await connections.get(body.connection_id)).revision
    document_id, url = await connections.resolve_document(body.connection_id, body.url)
    target_key = "feishu:" + document_id
    await records.idle(target_key)
    remote = await connections.target(body.connection_id, url)
    if remote.document_id != document_id:
        raise ExternalError("目标文档已变化，请重新绑定", 409)
    if not remote.can_write:
        raise ExternalError("应用没有目标文档的编辑权限", 403, "target_readonly")
    await connections.require_enabled(body.connection_id, expected_revision=connection_revision)
    await records.session.rollback()
    await records.session.execute(text("BEGIN IMMEDIATE"))
    # Recheck the note and sync slots while holding the writer reservation.
    note = await records.note(note_id)
    if note.revision != note_revision:
        raise ExternalError("文章已变化，请重新绑定", 409)
    await records.idle(target_key)
    current = await records.binding(note_id)
    if current:
        await records.idle(current.target_key)
    values = dict(
        connection_id=body.connection_id,
        document_id=document_id,
        target_key=target_key,
        url=url,
        title=remote.title,
        last_fingerprint="",
        last_note_revision=None,
        last_synced_at=None,
    )
    try:
        if current_id:
            result = await records.session.execute(
                update(ArticleSyncBinding)
                .where(
                    ArticleSyncBinding.id == current_id,
                    ArticleSyncBinding.revision == body.expected_revision,
                )
                .values(**values, revision=ArticleSyncBinding.revision + 1)
            )
            if result.rowcount != 1:
                raise ExternalError("绑定已变化，请刷新", 409)
        else:
            records.session.add(
                ArticleSyncBinding(owner_user_id=records.owner_user_id, note_id=note_id, **values)
            )
        await records.session.commit()
    except IntegrityError:
        await records.session.rollback()
        raise ExternalError("目标文档已有有效绑定，请使用另一份文档", 409, "target_bound") from None
    return binding_out(await records.binding(note_id))
