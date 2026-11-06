"""Save and delete template snapshots with atomic, recoverable asset pins."""

from uuid import uuid4

from studio.apps.thought_workshop.knowledge_tools.reuse import ReusableContent
from studio.apps.thought_workshop.multitable.schemas import Snapshot
from studio.apps.thought_workshop.multitable.storage import asset_ids
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.website.asset_metadata import AssetMetadata, describe_assets
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.runtime.ids import new_id


async def mutate_template_with_references(
    session,
    *,
    owner,
    template_id,
    assertion,
    source_method,
    source_path,
    references,
    body=None,
    expected_revision=None,
    asset_reader: AssetMetadata | None = None,
):
    if source_method not in {"PUT", "DELETE"} or source_path != (
        f"/v1/thought-workshop/templates/{template_id}"
    ):
        raise ValueError("模板引用修改必须绑定原模板请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("模板引用修改缺少账号上下文")
    if (source_method == "PUT") != (body is not None):
        raise ValueError("模板请求与内容不匹配")
    expected = body.expected_revision if body is not None else expected_revision
    if type(expected) is not int or expected < 0:
        raise ValueError("模板版本无效")
    content = ReusableContent(session, owner, assets=asset_reader)
    current = await content.template(template_id)
    if current.revision != expected:
        await content.template_conflict(template_id, expected)
    assets = await content.validate_template(body, current.document) if body is not None else set()
    await session.rollback()
    change = PrepareReferenceChange(
        request_id=uuid4().hex,
        resource_kind="template",
        resource_id=template_id,
        expected_resource_revision=expected,
        asset_ids=sorted(assets),
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
        result = (
            await content.update_template(template_id, body, commit=False)
            if body is not None
            else await content.delete_template(template_id, expected, commit=False)
        )
        await references.record(
            session, prepared, resource_revision=expected + 1, deleted=body is None
        )
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise


async def create_template_with_references(
    session, *, owner, body, assertion, source_method, source_path, references, asset_reader
):
    if source_method != "POST" or source_path != "/v1/thought-workshop/templates":
        raise ValueError("模板创建必须绑定原请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("模板创建缺少账号上下文")
    content = ReusableContent(session, owner, assets=asset_reader)
    assets = await content.validate_template(body)
    template_id = new_id()
    await session.rollback()
    change = PrepareReferenceChange(
        request_id=uuid4().hex,
        resource_kind="template",
        resource_id=template_id,
        expected_resource_revision=-1,
        asset_ids=sorted(assets),
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
        result = await content.create_template(body, template_id=template_id, commit=False)
        await references.record(session, prepared, resource_revision=result.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise


async def apply_template_with_references(
    session,
    *,
    owner,
    author_id,
    template_id,
    body,
    assertion,
    source_method,
    source_path,
    references,
    asset_reader,
):
    if (
        source_method != "POST"
        or source_path != f"/v1/thought-workshop/templates/{template_id}/apply"
    ):
        raise ValueError("应用模板必须绑定原请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("应用模板缺少账号上下文")
    content = ReusableContent(session, owner, author_id, assets=asset_reader)
    template = await content.template(template_id)
    if template.revision != body.expected_revision:
        await content.template_conflict(template_id, body.expected_revision)
    assets = file_ids(template.document)
    if template.multitable:
        assets |= asset_ids(Snapshot.model_validate(template.multitable))
    await describe_assets(asset_reader, assets)
    note_id = new_id()
    await session.rollback()
    change = PrepareReferenceChange(
        request_id=uuid4().hex,
        resource_kind="note",
        resource_id=note_id,
        expected_resource_revision=-1,
        asset_ids=sorted(assets),
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
        result = await content.apply_template(template_id, body, note_id=note_id, commit=False)
        await references.record(session, prepared, resource_revision=result.revision)
        commit_started = True
        await session.commit()
        return result
    except BaseException:
        if not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise
