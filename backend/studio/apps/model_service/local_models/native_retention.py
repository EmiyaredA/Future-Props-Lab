"""Confirmed delivery fences all future uploads before native byte cleanup."""

import asyncio

from sqlalchemy import delete, select

from studio.apps.model_service.storage.native_records import NativeModelJob, NativeModelProof
from studio.apps.model_service.storage.service_models import TaskAuthorization
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.time import utc_now


class NativeResultRetention:
    def __init__(self, database, artifact):
        self.database, self.artifact = database, artifact

    def upload_root(self):
        root = self.database.root / ".tmp" / "native-model-uploads"
        if root.is_symlink() or root.parent.is_symlink():
            raise ValueError("原生上传暂存目录不能是符号链接")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        return root

    async def retire(self, session, owner, task_id):
        if session.info.get("owner_user_id") != owner:
            raise OperationError("原生结果账号不匹配", "account_context_mismatch", 403)
        row = await session.scalar(
            select(NativeModelJob).where(
                NativeModelJob.request_id == "inference:" + task_id,
                NativeModelJob.owner_user_id == owner,
            )
        )
        if row is not None:
            if row.status not in {"completed", "failed"}:
                raise OperationError("原生结果仍未确认，不能删除", "task_busy", 409)
            row.applied_at, row.retired_at = utc_now(), utc_now()
            row.payload = {}
            proof = await session.get(NativeModelProof, row.id)
            if proof is not None:
                proof.assertion = ""
        await session.execute(
            delete(TaskAuthorization).where(
                TaskAuthorization.owner_user_id == owner,
                TaskAuthorization.kind == "inference",
                TaskAuthorization.task_id == task_id,
            )
        )

    async def cleanup_task(self, owner, task_id):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.scalar(
                select(NativeModelJob).where(NativeModelJob.request_id == "inference:" + task_id)
            )
            job_id = row.id if row is not None else None
        if job_id:
            await self.remove(owner, job_id)

    async def cleanup(self, *, startup=False):
        if startup:
            for temporary in self.upload_root().glob("*.tmp"):
                if temporary.is_symlink():
                    raise ValueError("原生上传暂存文件不能是符号链接")
                # No persisted descriptor ever points at request staging; the
                # worker retains its own result until the final receipt is acked.
                await asyncio.to_thread(temporary.unlink)
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            jobs = list(
                await session.execute(
                    select(NativeModelJob.owner_user_id, NativeModelJob.id)
                    .where(
                        NativeModelJob.applied_at.is_not(None),
                        NativeModelJob.artifacts_removed_at.is_(None),
                    )
                    .order_by(NativeModelJob.applied_at, NativeModelJob.id)
                    .limit(100)
                )
            )
        for owner, job_id in jobs:
            await self.remove(owner, job_id, startup=startup)

    async def remove(self, owner, job_id, *, startup=False):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(NativeModelJob, job_id)
            if row is None or row.applied_at is None or row.artifacts_removed_at is not None:
                return
            descriptor = dict(row.output_descriptor or {})
        if descriptor:
            target = self.artifact(job_id, descriptor["content_sha256"])

            def remove_files():
                if target.is_symlink() or target.parent.is_symlink():
                    raise ValueError("原生结果清理拒绝符号链接")
                target.unlink(missing_ok=True)
                if startup and target.parent.is_dir():
                    # Startup has no active HTTP uploads. Unfinished staging is
                    # disposable only after the durable applied/retired fence.
                    for temporary in target.parent.glob("*.tmp"):
                        if temporary.is_symlink():
                            raise ValueError("原生结果清理拒绝符号链接")
                        temporary.unlink()
                try:
                    target.parent.rmdir()
                except FileNotFoundError:
                    pass
                except OSError:
                    # An in-flight upload owns staging bytes; its finalization
                    # rechecks applied_at and cannot republish this result.
                    return False
                return True

            if not await asyncio.to_thread(remove_files):
                return
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(NativeModelJob, job_id)
            if row is not None and row.applied_at is not None:
                row.artifacts_removed_at = utc_now()
                await session.commit()
