"""Review a stopped task using remote snapshots, receipts and an explicit close."""

from sqlalchemy import delete, select, text

from app.apps.thought_workshop.external_sync.models import ArticleSyncAsset, ArticleSyncStep
from app.apps.thought_workshop.external_sync.records import task_out
from app.apps.thought_workshop.external_sync.schemas import ArticleSyncReconcileOut
from app.integrations.external.contracts import ExternalError
from app.runtime.time import utc_now
from fpl_runtime.external_sync import ExternalStepEvidence, ExternalStepProof
from fpl_runtime.integration_client import IntegrationAuthorizationUnavailable


def require_review(task):
    if task.status != "needs_review":
        raise ExternalError("任务不处于待核对状态", 409)


async def reconcile_task(records, reads, state, note_id, task_id, body):
    session = records.session
    task = await records.get_task(note_id, task_id)
    require_review(task)
    checkpoint = dict(task.checkpoint)
    if body.acknowledge_partial:
        await session.rollback()
        await reads.close_task(task_id)
        await session.execute(text("BEGIN IMMEDIATE"))
        task = await records.get_task(note_id, task_id)
        require_review(task)
        task.status = "failed"
        task.message = "用户已核对并结束任务；远端可能保留部分内容，下一次同步需重新预览"
        task.updated_at = utc_now()
        await session.execute(delete(ArticleSyncAsset).where(ArticleSyncAsset.task_id == task_id))
        output = ArticleSyncReconcileOut(task=task_out(task), remote_text="", can_resume=False)
        await session.commit()
        await state.thought_sync_artifacts.discard(checkpoint.get("staging", ""))
        return output

    expected = checkpoint.get("remote", task.remote)
    connection, revision = task.connection_id, task.connection_revision
    pending = list(
        await session.scalars(
            select(ArticleSyncStep)
            .where(
                ArticleSyncStep.task_id == task_id,
                ArticleSyncStep.status == "pending",
            )
            .limit(2)
        )
    )
    awaiting = (
        (pending[0].id, pending[0].result.get("request_sha256")) if len(pending) == 1 else None
    )
    has_pending = bool(pending)
    await session.rollback()
    remote = await reads.read_document(connection, revision, expected["document_id"])
    intent_id = checkpoint.get("intent_id")
    safe, confirmed = False, None
    if intent_id:
        try:
            decision = await state.thought_sync_intents.check(intent_id)
        except IntegrationAuthorizationUnavailable:
            raise ExternalError("同步授权暂不可用", 503, "authorization_unavailable") from None
        if decision.allowed and awaiting and awaiting[1]:
            proof = await state.thought_sync_transport.call(
                intent_id,
                "read",
                ExternalStepEvidence(step_id=awaiting[0], request_sha256=awaiting[1]),
                ExternalStepProof,
            )
            if proof.status == "confirmed":
                progress = await state.thought_sync_transport.progress(intent_id)
                if progress.status in {"active", "closed"} and progress.checkpoint:
                    snapshot = progress.checkpoint.model_dump()
                    if remote.snapshot() == snapshot["remote"]:
                        confirmed = (awaiting[0], proof.result)
                        updated = {**checkpoint, "progress": snapshot, "remote": snapshot["remote"]}
                        safe = True
        elif decision.allowed and not has_pending:
            updated = checkpoint
            safe = remote.snapshot() == expected

    await session.execute(text("BEGIN IMMEDIATE"))
    task = await records.get_task(note_id, task_id)
    require_review(task)
    if task.checkpoint != checkpoint:
        raise ExternalError("任务状态已变化，请刷新", 409)
    if safe:
        await records.note(note_id)
        binding = await records.binding(note_id)
        if (
            not binding
            or binding.id != task.binding_id
            or binding.revision != task.binding_revision
        ):
            raise ExternalError("绑定已变化，无法继续", 409)
        if confirmed is not None:
            step = await session.get(ArticleSyncStep, confirmed[0])
            if step is None or step.status != "pending":
                raise ExternalError("任务步骤已变化，请刷新", 409)
            step.status, step.result = "confirmed", confirmed[1]
        task.checkpoint = updated
        task.status, task.message = "queued", "远端与已确认步骤一致，将继续同步"
    else:
        task.message = "步骤、授权或远端状态需要核对；请明确结束任务后重新预览"
    task.updated_at = utc_now()
    output = ArticleSyncReconcileOut(task=task_out(task), remote_text=remote.text, can_resume=safe)
    await session.commit()
    return output
