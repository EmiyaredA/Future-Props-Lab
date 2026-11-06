"""Single-note table changes with a durable, transaction-bound Assets outcome."""

from uuid import uuid4

from studio.apps.thought_workshop.multitable.csv_exchange import import_csv
from studio.apps.thought_workshop.multitable.storage import asset_ids
from studio.apps.thought_workshop.multitable.use_cases import Multitable
from studio.contracts.asset_library.references import PrepareReferenceChange

from .retention import note_pin_ids


async def mutate_table_with_references(
    session,
    *,
    owner,
    author_id,
    note_id,
    expected_revision,
    assertion,
    source_method,
    source_path,
    references,
    body=None,
    history_revision=None,
    table_id=None,
    assets=None,
):
    prefix = f"/v1/thought-workshop/notes/{note_id}/multitable"
    if body is not None and history_revision is None and table_id is None:
        valid = (
            source_path == prefix + "/operations" and body.expected_revision == expected_revision
        )
    elif body is not None and history_revision is None and table_id is not None:
        valid = (
            source_path == prefix + f"/tables/{table_id}/csv-import"
            and body.expected_revision == expected_revision
        )
    elif body is None and type(history_revision) is int and history_revision >= 0:
        valid = source_path == prefix + f"/history/{history_revision}/restore"
    else:
        valid = False
    if source_method != "POST" or not valid:
        raise ValueError("多维表操作必须绑定原笔记请求")
    if session.info.get("owner_user_id") != owner:
        raise ValueError("多维表引用修改缺少账号上下文")
    prepared = None
    commit_started = False

    async def before_write(before, after):
        nonlocal prepared
        pins = await note_pin_ids(session, owner, note_id, asset_ids(before) | asset_ids(after))
        await session.rollback()
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="note",
            resource_id=note_id,
            expected_resource_revision=expected_revision,
            asset_ids=sorted(pins),
        )
        prepared = await references.prepare(
            owner=owner,
            assertion=assertion,
            source_method=source_method,
            source_path=source_path,
            change=change,
        )

    async def after_write(revision):
        nonlocal commit_started
        await references.record(session, prepared, resource_revision=revision)
        commit_started = True

    table = Multitable(session, owner, author_id, assets=assets)
    try:
        if body is not None and table_id is not None:
            return await import_csv(
                table, note_id, table_id, body, before_write=before_write, after_write=after_write
            )
        if body is not None:
            return await table.apply(
                note_id, body, before_write=before_write, after_write=after_write
            )
        return await table.restore(
            note_id,
            history_revision,
            expected_revision,
            before_write=before_write,
            after_write=after_write,
        )
    except BaseException:
        if prepared is not None and not commit_started:
            await session.rollback()
            await references.abort_after_rollback(session, prepared)
        raise
