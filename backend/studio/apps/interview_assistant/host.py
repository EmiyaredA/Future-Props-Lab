"""Claim, revalidate and settle one native execution for a frozen owned preparation."""

import asyncio
import base64
import hashlib
import os
import stat
import time
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from studio.apps.interview_assistant.files import MAX_FILE_BYTES, material_path
from studio.apps.interview_assistant.storage.models import InterviewPreparation, InterviewRoom
from studio.apps.interview_assistant.storage.service_models import InterviewNativeLease
from studio.contracts.agent_workbench.native import NativeLease
from studio.contracts.interview_assistant.documents import InterviewExecutorOut
from studio.contracts.interview_assistant.execution import (
    OPERATION,
    PERMISSION,
    ExecutionInput,
    ExecutionResult,
)
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.tasks.native_queue import digest
from studio.runtime.time import iso_utc, utc_now

EXECUTING = {"running", "validating"}
LEASE_TIME = timedelta(seconds=45)
WORKER_TIMEOUT = 20


def ended():
    return HTTPException(410, {"code": "interview_lease_ended"})


def material_bytes(path, expected):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_FILE_BYTES:
            raise ValueError("invalid material")
        body = stream.read(MAX_FILE_BYTES + 1)
    if len(body) != info.st_size or hashlib.sha256(body).hexdigest() != expected:
        raise ValueError("invalid material")
    return base64.b64encode(body).decode("ascii")


def payload(task):
    return ExecutionInput.model_validate(task, from_attributes=True).model_dump(mode="json")


class InterviewHost:
    def __init__(self, database, identity):
        self.database, self.identity = database, identity
        self.workers = {}

    def beat(self, worker, status):
        self.workers[worker] = (time.monotonic(), status)

    async def _allowed(self, owner):
        if self.identity is None:
            return False
        grant = await self.identity.owner_permission(owner=owner, permission=PERMISSION)
        return grant["allowed"] if grant["available"] else None

    async def status(self, user_id, owner, _session):
        ready = next(
            (
                info
                for seen, info in self.workers.values()
                if info.available and time.monotonic() - seen < WORKER_TIMEOUT
            ),
            None,
        )
        if ready is not None and user_id == owner and await self._allowed(owner):
            return InterviewExecutorOut(
                available=True, code="ready", message="本机 Codex 已就绪", version=ready.version
            )
        return InterviewExecutorOut(
            available=False,
            code="executor_unavailable",
            message="本机面试资料执行器不可用",
            version="",
        )

    async def expire(self):
        now = utc_now()
        async with self.database.sessions(info={"allow_system_reads": True}) as db:
            stale = list(
                (
                    await db.execute(
                        select(InterviewPreparation.id, InterviewPreparation.owner_user_id)
                        .join(
                            InterviewNativeLease,
                            InterviewNativeLease.task_id == InterviewPreparation.id,
                        )
                        .where(
                            InterviewPreparation.status.in_(EXECUTING),
                            InterviewNativeLease.expires_at <= now,
                        )
                        .limit(64)
                    )
                ).all()
            )
        for task_id, owner in stale:
            async with self.database.sessions(info={"owner_user_id": owner}) as db:
                await db.execute(text("BEGIN IMMEDIATE"))
                lease = await db.get(InterviewNativeLease, task_id)
                task = await db.get(InterviewPreparation, task_id)
                if task and task.status in EXECUTING and lease and lease.expires_at <= utc_now():
                    task.status = "interrupted"
                    task.message = "本机准备任务回执未确认，请手动重试"
                    task.updated_at = utc_now()
                    task.revision += 1
                    await db.commit()

    async def claim(self, worker, status):
        self.beat(worker, status)
        await self.expire()
        if not status.available:
            return None
        async with self.database.sessions(info={"allow_system_reads": True}) as db:
            next_task = (
                await db.execute(
                    select(InterviewPreparation.id, InterviewPreparation.owner_user_id)
                    .where(InterviewPreparation.status == "queued")
                    .order_by(InterviewPreparation.created_at, InterviewPreparation.id)
                    .limit(1)
                )
            ).one_or_none()
        if next_task is None:
            return None
        identifier, owner = next_task
        allowed = await self._allowed(owner)
        if allowed is None:
            return None
        async with self.database.sessions(info={"allow_system_reads": True}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            busy = await db.scalar(
                select(InterviewNativeLease.task_id)
                .join(InterviewPreparation, InterviewNativeLease.task_id == InterviewPreparation.id)
                .where(
                    InterviewNativeLease.worker_id == worker,
                    InterviewNativeLease.expires_at > utc_now(),
                    InterviewPreparation.status.in_(EXECUTING),
                )
                .limit(1)
            )
            if busy:
                return None
            db.info["owner_user_id"] = owner
            task = await db.get(InterviewPreparation, identifier)
            if task is None or task.status != "queued":
                return None
            room = await db.get(InterviewRoom, task.room_id)
            if not allowed or task.user_id != owner or not room or room.active_task_id != task.id:
                task.status, task.message = "interrupted", "执行者权限或输入已变化，请手动重试"
                task.revision += 1
                task.updated_at = utc_now()
                await db.commit()
                return None
            expiry = utc_now() + LEASE_TIME
            token = str(uuid4())
            result = NativeLease(
                job_id=task.id,
                lease_id=token,
                owner_user_id=owner,
                operation=OPERATION,
                payload=payload(task),
                lease_expires_at=expiry.isoformat(),
            )
            task.status, task.message = "running", "正在启动本机 Codex"
            task.revision += 1
            task.updated_at = utc_now()
            db.add(
                InterviewNativeLease(
                    task_id=task.id,
                    owner_user_id=owner,
                    worker_id=worker,
                    lease_id=token,
                    expires_at=expiry,
                )
            )
            await db.commit()
            return result

    async def _bound(self, db, worker, lease):
        record = await db.get(InterviewNativeLease, str(lease.job_id))
        task = await db.get(InterviewPreparation, str(lease.job_id))
        if (
            record is None
            or task is None
            or (record.worker_id, record.lease_id) != (worker, str(lease.lease_id))
            or task.user_id != lease.owner_user_id
            or lease.operation != OPERATION
            or payload(task) != lease.payload
        ):
            raise ended()
        return record, task

    async def _current(self, db, task):
        room = await db.get(InterviewRoom, task.room_id)
        if room and (room.active_task_id, room.input_version) == (task.id, task.input_version):
            return room
        return None

    async def _active(self, db, worker, lease):
        record, task = await self._bound(db, worker, lease)
        if (
            task.status not in EXECUTING
            or record.expires_at <= utc_now()
            or not await self._current(db, task)
        ):
            raise ended()
        return record, task

    async def active(self, worker, lease):
        if not await self._allowed(lease.owner_user_id):
            raise ended()
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            record, _ = await self._active(db, worker, lease)
            if record.expires_at - utc_now() < LEASE_TIME / 2:
                record.expires_at = utc_now() + LEASE_TIME
                await db.commit()

    async def material(self, worker, lease):
        await self.active(worker, lease)
        material = lease.payload["snapshot"]["material"]
        if material is None:
            return {"bytes": None}
        try:
            path = material_path(
                lease.owner_user_id,
                lease.payload["room_id"],
                material["id"],
                material["filename"],
                state_root=self.database.root,
            )
            return {"bytes": await asyncio.to_thread(material_bytes, path, material["sha256"])}
        except (OSError, ValueError, OperationError):
            raise HTTPException(409, {"code": "interview_material_changed"}) from None

    async def event(self, worker, lease, event):
        if not await self._allowed(lease.owner_user_id):
            raise ended()
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            _, task = await self._active(db, worker, lease)
            if len(task.events) >= 500:
                return
            task.events = [
                *task.events,
                {**event.model_dump(), "at": iso_utc(utc_now()), "sequence": len(task.events) + 1},
            ]
            if event.kind == "validating":
                task.status = "validating"
            task.message = event.message
            task.updated_at = utc_now()
            task.revision += 1
            await db.commit()

    async def settle(self, worker, lease, outcome):
        checksum = digest(outcome.model_dump(mode="json"))
        delivery = None
        if outcome.status == "completed":
            try:
                delivery = ExecutionResult.model_validate(outcome.result)
            except ValidationError:
                raise HTTPException(422, {"code": "interview_delivery_invalid"}) from None
            if (delivery.bundle.task_id, delivery.bundle.input_hash) != (
                str(lease.job_id),
                lease.payload.get("input_hash"),
            ):
                raise HTTPException(422, {"code": "interview_delivery_invalid"})
        allowed = await self._allowed(lease.owner_user_id)
        if allowed is None:
            raise HTTPException(503, {"code": "interview_authority_unavailable"})
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            record, task = await self._bound(db, worker, lease)
            if record.outcome_sha256 is not None:
                if record.outcome_sha256 != checksum:
                    raise HTTPException(409, {"code": "interview_receipt_conflict"})
                return
            record.outcome_sha256 = checksum
            if task.status in EXECUTING:
                room = await self._current(db, task)
                if (
                    not allowed
                    or room is None
                    or record.expires_at <= utc_now()
                    or outcome.status == "unknown"
                ):
                    task.status, task.message = "interrupted", "任务授权或回执已失效，请手动重试"
                elif delivery is None:
                    task.status, task.message = (
                        "failed",
                        outcome.message or "本机准备失败，请手动重试",
                    )
                else:
                    task.status, task.message = delivery.state, delivery.message
                    task.result = delivery.bundle.model_dump(mode="json")
                    if delivery.state == "succeeded":
                        room.active_bundle_id = task.id
                        room.revision += 1
                        room.updated_at = utc_now()
                task.revision += 1
                task.updated_at = utc_now()
            await db.commit()
