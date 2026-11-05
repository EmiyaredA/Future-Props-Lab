"""Prepare each copied document's independent and recoverable Assets projection."""

from uuid import uuid4

from sqlalchemy import text

from app.apps.thought_workshop.knowledge_tools.reuse import ReusableContent
from app.apps.thought_workshop.notes import Notes
from fpl_runtime.asset_references import PrepareReferenceChange


async def duplicate_with_references(
    session, *, owner, author_id, note_id, body, assertion, source_method, source_path, references
):
    if source_method != "POST" or source_path != f"/v1/thought-workshop/notes/{note_id}/duplicate":
        raise ValueError("文档复制必须绑定原请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("文档复制缺少账号上下文")

    prepared = {}

    async def prepare(pins):
        for copy_id, assets in pins.items():
            prepared[copy_id] = await references.prepare(
                owner=owner,
                assertion=assertion,
                source_method=source_method,
                source_path=source_path,
                change=PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="note",
                    resource_id=copy_id,
                    expected_resource_revision=-1,
                    asset_ids=sorted(assets),
                ),
            )

    commit_started = False
    try:
        await session.execute(text("BEGIN"))
        result = await ReusableContent(session, owner, author_id).duplicate(
            note_id, body, prepare=prepare, commit=False
        )
        notes = Notes(session, owner)
        for copy_id, reference in prepared.items():
            note = await notes.get(copy_id)
            await references.record(session, reference, resource_revision=note.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            for reference in prepared.values():
                await references.abort_after_rollback(session, reference)
        raise
