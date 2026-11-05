"""Read or advance only the signed Models task behind a Visual plan."""

from sqlalchemy import text

from app.llm.generation_state import can_recover_generation_result
from app.llm.visual_generation_model import VisualGenerationValidationError
from app.runtime.time import utc_now

from .admission import settle
from .visual_generation_records import VisualProviderTask


def task_view(row):
    metadata = dict(row.result_metadata or {})
    metadata.pop("key", None)
    metadata.pop("delivered", None)
    return {
        "task_id": row.id,
        "status": row.status,
        "provider_task_id": row.provider_task_id,
        "progress": row.progress,
        "execution_info": row.execution_info,
        "error_message": row.error_message,
        "revision": row.revision,
        "can_retry_materialization": can_recover_generation_result(row),
        "result": metadata or None,
    }


class VisualGenerationResults:
    def __init__(self, state):
        self.state = state
        self.sessions = state.database.sessions
        self.intake = state.visual_generation_intake

    async def row(self, session, project, identity, digest, task_id):
        batch = await self.intake.batch(session, project, identity, digest)
        task = await session.get(VisualProviderTask, task_id)
        if batch is None or batch.state != "active" or task is None or task.batch_id != identity:
            raise VisualGenerationValidationError("生成任务不存在", code="not_found", status=404)
        return task

    async def status(self, owner, project, identity, digest, task_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            return task_view(await self.row(session, project, identity, digest, task_id))

    async def change(self, owner, project, identity, digest, task_id, action, expected):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self.row(session, project, identity, digest, task_id)
            if action == "retry" and row.last_retry_revision == expected:
                return task_view(row)
            if action == "cancel" and row.status == "cancelled" and row.revision == expected + 1:
                return task_view(row)
            if row.revision != expected:
                raise VisualGenerationValidationError(
                    "生成任务版本已变化", code="revision_conflict", status=409
                )
            if action == "cancel":
                if row.status != "queued" or row.generation_kind == "audio":
                    raise VisualGenerationValidationError(
                        "生成任务不能取消", code="cancel_unavailable", status=409
                    )
                row.status = "cancelled"
            else:
                if not can_recover_generation_result(row):
                    raise VisualGenerationValidationError(
                        "生成结果不能重试落盘", code="retry_unavailable", status=409
                    )
                row.last_retry_revision = expected
                row.status = "processing" if row.result_url else "pending"
            row.error_message = None
            row.revision += 1
            row.updated_at = utc_now()
            if action == "cancel":
                await settle(session)
            await session.commit()
            return task_view(row)

    async def file(self, owner, project, identity, digest, task_id, sha256):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await self.row(session, project, identity, digest, task_id)
            metadata = dict(row.result_metadata or {})
        if not metadata or metadata.get("delivered") or metadata.get("sha256") != sha256:
            raise VisualGenerationValidationError("生成结果不存在", code="not_found", status=404)
        root = self.state.visual_generation_runner.output_root(owner)
        path = root / metadata["key"]
        if (
            path.is_symlink()
            or not path.resolve().is_relative_to(root)
            or not path.is_file()
            or path.stat().st_size != metadata["byte_size"]
        ):
            raise VisualGenerationValidationError(
                "生成结果原件暂不可用", code="result_unavailable", status=503
            )
        return path, metadata

    async def acknowledge(self, owner, project, identity, digest, task_id, sha256):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self.row(session, project, identity, digest, task_id)
            metadata = dict(row.result_metadata or {})
            if row.status != "completed" or metadata.get("sha256") != sha256:
                raise VisualGenerationValidationError(
                    "生成结果不存在", code="not_found", status=404
                )
            metadata["delivered"] = True
            row.result_metadata = metadata
            await session.commit()
        root = self.state.visual_generation_runner.output_root(owner)
        path = root / metadata["key"]
        if not path.is_symlink() and path.resolve().is_relative_to(root):
            path.unlink(missing_ok=True)
        return {"state": "acknowledged"}
