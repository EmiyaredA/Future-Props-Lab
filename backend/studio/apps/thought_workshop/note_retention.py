"""One note save with Assets preparation and a transactionally durable outcome."""

from uuid import uuid4

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.references import validate_targets
from studio.apps.thought_workshop.notes import Notes
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.contracts.asset_library.references import PrepareReferenceChange

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
    assets=None,
    accounts=None,
    _restoring=False,
):
    """Prepare exact current/history pins, save the note, and record the outcome atomically.

    The source session performs all network-free reads before it releases its
    read transaction.  The metadata adapter must have cached validation for the
    current request before any remote prepare or write reservation occurs.
    """
    if _restoring:
        import re

        prefix = re.escape(f"/v1/thought-workshop/notes/{note_id}/history/")
        if source_method != "POST" or not re.fullmatch(prefix + r"[^/]+/restore", source_path):
            raise ValueError("历史恢复必须绑定原笔记请求")
    if not _restoring and (
        source_method != "PUT" or source_path != f"/v1/thought-workshop/notes/{note_id}"
    ):
        raise ValueError("笔记引用修改必须绑定原笔记保存请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("笔记引用修改缺少账号上下文")
    notes = Notes(session, owner, author_id, assets=assets, accounts=accounts)
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
        result = await notes.put(note_id, body, restoring=_restoring, commit=False)
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


async def apply_operations_with_references(
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
    assets=None,
    accounts=None,
):
    """Persist the operation receipt and reference decision in the same note transaction."""
    from studio.apps.thought_workshop.notes import note_out
    from studio.apps.thought_workshop.operations import transform
    from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteOut
    from studio.runtime.database.operation_receipts import record, replay
    from studio.runtime.revisions import RevisionConflictError

    if source_method != "POST" or source_path != f"/v1/thought-workshop/notes/{note_id}/operations":
        raise ValueError("笔记操作必须绑定原笔记请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("笔记引用修改缺少账号上下文")
    notes = Notes(session, owner, author_id, assets=assets, accounts=accounts)
    current = note_out(await notes.get(note_id))
    key = dict(owner_user_id=owner, kind="thought", resource_id=note_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return ThoughtNoteOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    await validate_targets(session, owner, candidate.document, current.document)
    await notes.validate_refs(candidate)
    pins = await note_pin_ids(session, owner, note_id, file_ids(candidate.document))
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
        result = await notes.put(note_id, candidate, commit=False)
        record(session, **key, result=result)
        await references.record(session, prepared, resource_revision=result.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException as exc:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
            if isinstance(exc, RevisionConflictError):
                saved = await replay(session, **key)
                if saved is not None:
                    return ThoughtNoteOut.model_validate(saved)
        raise


async def restore_history_with_references(
    session,
    *,
    owner,
    author_id,
    note_id,
    history_id,
    expected_revision,
    assertion,
    source_method,
    source_path,
    references,
    assets=None,
    accounts=None,
):
    from studio.apps.thought_workshop.history import CONTENT_FIELDS, History
    from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteIn, ThoughtNotePut

    if source_method != "POST" or source_path != (
        f"/v1/thought-workshop/notes/{note_id}/history/{history_id}/restore"
    ):
        raise ValueError("历史恢复必须绑定原笔记请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("笔记引用修改缺少账号上下文")
    current = await Notes(session, owner, author_id, assets=assets, accounts=accounts).get(note_id)
    selected = await History(session).get(note_id, history_id)
    body = ThoughtNotePut(
        **{
            key: getattr(current, key)
            for key in ThoughtNoteIn.model_fields
            if key not in CONTENT_FIELDS
        },
        **{key: getattr(selected, key) for key in CONTENT_FIELDS},
        expected_revision=expected_revision,
    )
    return await save_note_with_references(
        session,
        owner=owner,
        author_id=author_id,
        note_id=note_id,
        body=body,
        assertion=assertion,
        source_method=source_method,
        source_path=source_path,
        references=references,
        assets=assets,
        accounts=accounts,
        _restoring=True,
    )
