"""Enroll a confirmed sync preview, then make the immutable work visible to the runner."""

import json
from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.apps.integrations.clients.document_blocks import feishu_tree
from studio.apps.thought_workshop.external_sync.models import ArticleSyncTask
from studio.apps.thought_workshop.external_sync.preview import actor_snapshot
from studio.apps.thought_workshop.external_sync.records import task_out
from studio.contracts.integrations.external_documents import ExternalError
from studio.contracts.integrations.external_sync import MAX_EXTERNAL_STEP_BYTES, ExternalTaskPayload
from studio.contracts.integrations.integration_intents import IntegrationScope
from studio.runtime.time import utc_now


async def replay(records, note_id, body):
    existing = await records.session.scalar(
        select(ArticleSyncTask).where(
            ArticleSyncTask.owner_user_id == records.owner_user_id,
            ArticleSyncTask.operation_id == str(body.operation_id),
        )
    )
    if existing is None:
        return None
    if existing.note_id != note_id or existing.id != body.preview_id:
        raise ExternalError("操作标识已用于其他同步", 409)
    return task_out(existing)


async def current_preview(records, note_id, body):
    task = await records.get_task(note_id, body.preview_id)
    if task.status != "preview" or not body.confirm_replace:
        raise ExternalError("请重新预览并明确确认替换目标正文", 409)
    if task.created_at < utc_now() - timedelta(hours=1):
        raise ExternalError("预览已过期，请重新预览", 409, "preview_expired")
    note, binding = await records.note(note_id), await records.binding(note_id)
    if (
        note.revision != task.note_revision
        or not binding
        or binding.id != task.binding_id
        or binding.revision != task.binding_revision
    ):
        raise ExternalError("文章或绑定已变化，请重新预览", 409)
    await records.idle(task.target_key)
    return task


def require_step_budget(payload):
    tree = feishu_tree(payload.content["nodes"])
    append_bytes = len(json.dumps(tree, ensure_ascii=False, separators=(",", ":")).encode())
    image_bytes = max(
        (4 * ((asset.byte_size + 2) // 3) for asset in payload.asset_manifest),
        default=0,
    )
    # Reserve room for the step UUID, block ID, revision and escaped provider token.
    if (
        len(payload.model_dump_json().encode()) + max(append_bytes, image_bytes) + 8192
        > MAX_EXTERNAL_STEP_BYTES
    ):
        raise ExternalError("同步正文及图片超过传输限制", 413, "sync_payload_too_large")


async def submit_task(records, reads, request, note_id, body):
    session, state = records.session, request.app.state
    prior = await replay(records, note_id, body)
    if prior is not None:
        return prior
    task = await current_preview(records, note_id, body)
    content, expected = dict(task.content), dict(task.remote)
    connection, revision = task.connection_id, task.connection_revision
    await session.rollback()
    remote = await reads.read_document(connection, revision, expected["document_id"])
    if remote.fingerprint != expected["fingerprint"] or remote.revision != expected["revision"]:
        raise ExternalError("飞书内容已变化，请重新预览再确认", 409, "remote_changed")
    artifacts = state.thought_sync_artifacts
    staging, committing = "", False
    try:
        staging, asset_manifest = await artifacts.capture(
            session, records.owner_user_id, content["asset_ids"]
        )
        payload = ExternalTaskPayload(
            content=content, remote=expected, asset_manifest=asset_manifest
        )
        require_step_budget(payload)
        scope = IntegrationScope(
            kind="external.sync",
            task_id=body.preview_id,
            source_resource_id=note_id,
            connection_id=connection,
            connection_revision=revision,
            document_id=expected["document_id"],
            input_sha256=payload.fingerprint(),
        )
        await reads.require_enabled(connection, expected_revision=revision)
        receipt = await state.thought_sync_intents.enroll(
            request_id=body.operation_id,
            assertion=request.state.service_assertion,
            method=request.method,
            path=request.url.path,
            scope=scope,
        )
        await session.execute(text("BEGIN IMMEDIATE"))
        prior = await replay(records, note_id, body)
        if prior is not None:
            return prior
        task = await current_preview(records, note_id, body)
        task.status = "queued"
        task.operation_id = str(body.operation_id)
        task.actor = actor_snapshot(records.principal)
        task.updated_at = utc_now()
        task.checkpoint = {
            "intent_id": str(receipt.id),
            "payload": payload.model_dump(mode="json"),
            "staging": staging,
            "remote": expected,
        }
        await session.flush()
        committing = True
        await session.commit()
        return task_out(task)
    except IntegrationAuthorizationUnavailable:
        raise ExternalError("同步授权暂不可用", 503, "authorization_unavailable") from None
    except IntegrityError:
        await session.rollback()
        prior = await replay(records, note_id, body)
        if prior is not None:
            return prior
        raise ExternalError("目标文档存在执行中的任务", 409, "target_busy") from None
    except (OSError, ValueError):
        raise ExternalError("同步图片快照无法保存", 503, "sync_snapshot_unavailable") from None
    finally:
        if not committing:
            await session.rollback()
            await artifacts.discard(staging)
