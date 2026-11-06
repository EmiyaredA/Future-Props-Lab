"""Create documents and their initial Assets projection atomically."""

from uuid import uuid4

from studio.apps.thought_workshop.directory import Directory
from studio.apps.thought_workshop.notes import Notes
from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteIn
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.runtime.ids import new_id


async def create_note_with_references(
    session,
    *,
    owner,
    author_id,
    body,
    assertion,
    source_method,
    source_path,
    references,
    project_id=None,
    assets=None,
    accounts=None,
):
    if source_method != "POST" or source_path != (
        f"/v1/thought-workshop/knowledge-bases/{project_id}/documents"
        if project_id is not None
        else "/v1/thought-workshop/notes"
    ):
        raise ValueError("新建文档必须绑定原请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("新建文档缺少账号上下文")
    directory = Directory(session, owner, author_id, assets=assets, accounts=accounts)
    if project_id is None:
        candidate = ThoughtNoteIn(**body.model_dump(exclude={"expected_knowledge_revision"}))
    else:
        candidate = ThoughtNoteIn(
            knowledge_base_id=project_id, parent_id=body.parent_id, title=body.title, kind=body.kind
        )
    pins = await Notes(session, owner, author_id, assets=assets, accounts=accounts).validate_refs(
        candidate
    )
    note_id = new_id()
    await session.rollback()
    change = PrepareReferenceChange(
        request_id=uuid4().hex,
        resource_kind="note",
        resource_id=note_id,
        expected_resource_revision=-1,
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
        if project_id is None:
            result = await directory.create_content(body, note_id=note_id, commit=False)
        else:
            result = await directory.create_note(project_id, body, note_id=note_id, commit=False)
        await references.record(session, prepared, resource_revision=result.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise
