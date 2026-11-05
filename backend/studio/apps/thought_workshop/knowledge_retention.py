"""Preserve Assets projections when creating or updating document projects."""

from uuid import uuid4

from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.schemas.knowledge import KnowledgeBaseIn, KnowledgeBasePut
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError


async def create_knowledge_base_with_references(
    session,
    *,
    owner,
    author_id,
    body: KnowledgeBaseIn,
    assertion,
    source_method,
    source_path,
    references,
):
    if source_method != "POST" or source_path != "/v1/thought-workshop/knowledge-bases":
        raise ValueError("新建知识库必须绑定原请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("新建知识库缺少账号上下文")

    bases = KnowledgeBases(session, owner, author_id)
    await bases.cover(body.cover_asset_id)
    project_id, home_note_id = new_id(), new_id()
    await session.rollback()

    changes = [
        PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="knowledge-base",
            resource_id=project_id,
            expected_resource_revision=-1,
            asset_ids=[body.cover_asset_id] if body.cover_asset_id else [],
        ),
        PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="note",
            resource_id=home_note_id,
            expected_resource_revision=-1,
            asset_ids=[],
        ),
    ]
    prepared = []
    commit_started = False
    try:
        for change in changes:
            prepared.append(
                await references.prepare(
                    owner=owner,
                    assertion=assertion,
                    source_method=source_method,
                    source_path=source_path,
                    change=change,
                )
            )
        result = await bases.create(
            body,
            project_id=project_id,
            home_note_id=home_note_id,
            commit=False,
            cover_validated=True,
        )
        for reference in prepared:
            await references.record(session, reference, resource_revision=0)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            for reference in prepared:
                await references.abort_after_rollback(session, reference)
        raise


async def update_knowledge_base_with_references(
    session,
    *,
    owner,
    project_id,
    body: KnowledgeBasePut,
    assertion,
    source_method,
    source_path,
    references,
):
    if (
        source_method != "PUT"
        or source_path != f"/v1/thought-workshop/knowledge-bases/{project_id}"
    ):
        raise ValueError("更新知识库必须绑定原请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("更新知识库缺少账号上下文")

    bases = KnowledgeBases(session, owner)
    current = await bases.get(project_id)
    expected = body.expected_revision
    if current.revision != expected:
        snapshot = await bases.output(current)
        raise RevisionConflictError(expected, snapshot.revision, snapshot.model_dump(mode="json"))
    await bases.cover(body.cover_asset_id)
    await session.rollback()

    prepared = await references.prepare(
        owner=owner,
        assertion=assertion,
        source_method=source_method,
        source_path=source_path,
        change=PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="knowledge-base",
            resource_id=project_id,
            expected_resource_revision=expected,
            asset_ids=[body.cover_asset_id] if body.cover_asset_id else [],
        ),
    )
    commit_started = False
    try:
        result = await bases.put(project_id, body, commit=False, cover_validated=True)
        await references.record(session, prepared, resource_revision=result.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise
