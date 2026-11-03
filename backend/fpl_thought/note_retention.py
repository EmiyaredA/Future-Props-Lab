"""One note save with Assets preparation and a transactionally durable outcome."""

from uuid import uuid4

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge_tools.references import validate_targets
from app.apps.thought_workshop.notes import Notes
from app.apps.thought_workshop.schemas.document import file_ids
from fpl_runtime.asset_references import PrepareReferenceChange

from .retention import note_pin_ids


async def save_note_with_references(
    session,
    *,
    owner,
    author_id,
    note_id,
    body,
    assertion,
    source_method,
    source_path,
    references,
):
    """Prepare exact current/history pins, save the note, and record the outcome atomically.

    The source session performs all network-free reads before it releases its
    read transaction.  The metadata adapter must have cached validation for the
    current request before any remote prepare or write reservation occurs.
    """
    if source_method != "PUT" or source_path != f"/v1/thought-workshop/notes/{note_id}":
        raise ValueError("笔记引用修改必须绑定原笔记保存请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("笔记引用修改缺少账号上下文")
    notes = Notes(session, owner, author_id)
    current = await notes.get(note_id)
    if current.revision != body.expected_revision:
        await notes.conflict(note_id, body.expected_revision)
    await validate_targets(session, owner, body.document, current.document)
    await notes.validate_refs(body)
    pins = await note_pin_ids(session, owner, note_id, file_ids(body.document))
    await session.rollback()
    change = PrepareReferenceChange(
        request_id=uuid4().hex,
        resource_kind="note",
        resource_id=note_id,
        expected_resource_revision=body.expected_revision,
        asset_ids=sorted(pins),
    )
    prepared = await references.prepare(
        owner=owner,
        assertion=assertion,
        source_method=source_method,
        source_path=source_path,
        change=change,
    )
    commit_started = False
    try:
        result = await notes.put(note_id, body, commit=False)
        await references.record(session, prepared, resource_revision=result.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise


async def purge_note_with_references(
    session,
    *,
    owner,
    note_id,
    expected_revision,
    expected_knowledge_revision,
    assertion,
    source_method,
    source_path,
    references,
):
    if source_method != "DELETE" or source_path != f"/v1/thought-workshop/notes/{note_id}":
        raise ValueError("笔记引用删除必须绑定原笔记删除请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("笔记引用删除缺少账号上下文")
    notes = Notes(session, owner)
    current = await notes.get(note_id)
    if current.revision != expected_revision:
        await notes.conflict(note_id, expected_revision)
    if current.is_home:
        raise ThoughtError("首页不能单独删除或恢复")
    if current.deleted_at is None:
        raise ThoughtError("只能永久删除回收站笔记", 409, "note_not_trashed")
    await session.rollback()
    change = PrepareReferenceChange(
        request_id=uuid4().hex,
        resource_kind="note",
        resource_id=note_id,
        expected_resource_revision=expected_revision,
        asset_ids=[],
    )
    prepared = await references.prepare(
        owner=owner,
        assertion=assertion,
        source_method=source_method,
        source_path=source_path,
        change=change,
    )
    commit_started = False
    try:
        result = await notes.transition(
            note_id,
            expected_revision,
            "purge",
            expected_knowledge_revision,
            commit=False,
        )
        await references.record(
            session, prepared, resource_revision=expected_revision + 1, deleted=True
        )
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise
