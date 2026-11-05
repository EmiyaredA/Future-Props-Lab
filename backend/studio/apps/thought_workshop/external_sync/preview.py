"""Build a frozen article preview and store it only while the source revisions match."""

import httpx
from sqlalchemy import text

from studio.apps.integrations.clients.document_blocks import feishu_tree
from studio.apps.thought_workshop.content_exports import resolve_assets
from studio.apps.thought_workshop.external_sync.content import (
    TABLE_SNAPSHOT,
    has_multitable_view,
    project_content,
)
from studio.apps.thought_workshop.external_sync.models import ArticleSyncAsset, ArticleSyncTask
from studio.apps.thought_workshop.external_sync.schemas import ArticleSyncPreview, SnapshotBlock
from studio.apps.thought_workshop.multitable.content import project as project_tables
from studio.contracts.integrations.external_documents import ExternalError


def actor_snapshot(principal):
    return {
        "user_id": principal.user_id,
        "auth_kind": principal.auth_kind,
        "api_key_id": principal.api_key_id,
    }


async def preview_note(records, read_target, note_id, body):
    session, owner = records.session, records.owner_user_id
    await session.execute(text("BEGIN"))
    note = await records.note(note_id)
    if note.revision != body.expected_revision:
        raise ExternalError("文章已变化，请保存后重新预览", 409, "note_changed")
    binding = await records.binding(note_id)
    if not binding or binding.revision != body.binding_revision:
        raise ExternalError("绑定已变化，请重新预览", 409)
    await records.idle(binding.target_key)
    expanded = await project_tables(session, owner, note)
    content = project_content(note.title, expanded)
    if note.kind == "multitable" or has_multitable_view(note.document):
        content["warnings"] = sorted({*content["warnings"], TABLE_SNAPSHOT})
    if not content["blockers"]:
        try:
            feishu_tree(content["nodes"])
        except ExternalError as exc:
            content["blockers"].append(str(exc))
    fields = dict(
        owner_user_id=owner,
        note_id=note_id,
        binding_id=binding.id,
        binding_revision=binding.revision,
        connection_id=binding.connection_id,
        target_key=binding.target_key,
        note_revision=note.revision,
        content=content,
        actor=actor_snapshot(records.principal),
    )
    document_id, previous = binding.document_id, binding.last_fingerprint
    await session.rollback()
    assets = await resolve_assets(session, owner, set(content["asset_ids"]))
    for asset in assets.values():
        if asset.byte_size > 20 * 1024 * 1024 or asset.mime_type not in {
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
        }:
            content["blockers"].append(f"图片 {asset.original_filename} 格式不支持或超过 20 MiB")
    try:
        connection_revision, remote = await read_target(fields["connection_id"], document_id)
    except httpx.HTTPError:
        raise ExternalError("飞书连接失败，请重试", 502) from None
    await session.rollback()
    task_id = None
    if not content["blockers"]:
        await session.execute(text("BEGIN IMMEDIATE"))
        current = await records.note(note_id)
        bound = await records.binding(note_id)
        if (
            current.revision != fields["note_revision"]
            or not bound
            or bound.id != fields["binding_id"]
            or bound.revision != fields["binding_revision"]
        ):
            raise ExternalError("文章或绑定已变化，请重新预览", 409)
        await records.idle(fields["target_key"])
        task = ArticleSyncTask(
            **fields, connection_revision=connection_revision, remote=remote.snapshot()
        )
        session.add(task)
        await session.flush()
        task_id = task.id
        session.add_all(
            ArticleSyncAsset(task_id=task_id, asset_id=id) for id in content["asset_ids"]
        )
        await session.commit()
    return ArticleSyncPreview(
        preview_id=task_id,
        note_revision=fields["note_revision"],
        local_text=content["text"],
        snapshot=[SnapshotBlock.model_validate(node) for node in content["nodes"]],
        remote_text=remote.text,
        target_title=remote.title,
        warnings=content["warnings"],
        blockers=content["blockers"],
        remote_changed=bool(previous and previous != remote.fingerprint),
        first_sync=not previous,
    )
