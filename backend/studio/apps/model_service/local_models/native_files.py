"""Native result streams end before Models opens its short delivery transaction."""

import asyncio
import hashlib
import os
from dataclasses import asdict
from uuid import uuid4

from sqlalchemy import text

from app.capabilities.asset_store.policy import validate_file_structure
from studio.apps.model_service.storage.native_records import NativeModelJob
from studio.runtime.database.operation_receipts import OperationError


async def accept_result(broker, worker, job_id, lease_id, description, chunks):
    job, proof = await broker.lease(worker, job_id, lease_id, finalizing=True)
    if job.operation != "models.synthesize" or proof.accepted_at is None:
        raise OperationError("原生结果缺少执行意图", "native_not_started", 403)
    if description.filename != "result.wav" or description.mime_type != "audio/wav":
        raise OperationError("原生输出类型无效", "native_output_invalid", 422)
    if description.byte_size > broker.settings.fpl_visual_asset_max_bytes:
        raise OperationError("原生输出超过大小限制", "native_output_too_large", 413)
    document = asdict(description)
    if job.output_descriptor is not None:
        if job.output_descriptor != document:
            raise OperationError("原生结果不可更换", "native_output_conflict", 409)
        if job.applied_at is not None:
            return {"stored": True}
        final = broker.artifact(job_id, description.content_sha256)
        if final.is_file() and final.stat().st_size == description.byte_size:
            from studio.runtime.files.signed_payloads import ModelOutputDescription

            observed = await asyncio.to_thread(
                ModelOutputDescription.from_file, final, "result.wav", "audio/wav"
            )
            if observed == description:
                return {"stored": True}
        # Re-uploading the exact accepted digest can repair a lost local copy.
        # It never authorizes replacing the job's immutable output descriptor.
    final = broker.artifact(job_id, description.content_sha256)
    temporary = broker.retention.upload_root() / (uuid4().hex + ".tmp")
    size, checksum = 0, hashlib.sha256()
    try:
        with temporary.open("xb") as target:
            async for chunk in chunks:
                size += len(chunk)
                if size > description.byte_size:
                    raise OperationError("原生结果长度不匹配", "native_output_changed", 422)
                checksum.update(chunk)
                target.write(chunk)
        if size != description.byte_size or checksum.hexdigest() != description.content_sha256:
            raise OperationError("原生结果摘要不匹配", "native_output_changed", 422)
        if not await asyncio.to_thread(validate_file_structure, temporary, ".wav"):
            raise OperationError("原生结果不是有效音频", "native_output_invalid", 422)
        async with broker.database.sessions(info={"owner_user_id": job.owner_user_id}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(NativeModelJob, job_id)
            if current is None or current.lease_id != lease_id or current.worker_id != worker:
                raise OperationError("原生租约不匹配", "native_lease_conflict", 409)
            if current.output_descriptor is not None and current.output_descriptor != document:
                raise OperationError("原生结果不可更换", "native_output_conflict", 409)
            if current.applied_at is not None:
                return {"stored": True}
            final.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.replace(temporary, final)
            current.output_descriptor = document
            await session.commit()
        return {"stored": True}
    except BaseException:
        temporary.unlink(missing_ok=True)
        # A failed commit acknowledgement cannot prove that final is unreferenced.
        # Deterministic same-digest uploads can overlap. Retain a published file
        # until owned reconciliation proves no accepted receipt can reference it.

        raise
    finally:
        temporary.unlink(missing_ok=True)
