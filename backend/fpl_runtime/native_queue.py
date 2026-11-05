"""Owned native tasks with idempotent requests and immutable execution receipts."""

import asyncio
import hashlib
import json
import time
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from .native_protocol import NativeLease, NativeOutcome


class NativeQueueError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def digest(value):
    encoded = json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode()
    if len(encoded) > 32 * 1024 * 1024:
        raise NativeQueueError("native_payload_too_large")
    return hashlib.sha256(encoded).hexdigest()


def bind(session, owner):
    if not isinstance(owner, str) or not owner.strip():
        raise NativeQueueError("native_owner_required")
    session.info["owner_user_id"] = owner


def snapshot(row):
    return {
        "id": row.id,
        "status": row.status,
        "operation": row.operation,
        "result": row.result,
        "error_code": row.error_code,
        "message": row.message,
        "revision": row.revision,
    }


class NativeQueue:
    def __init__(self, database, model, *, operations, clock):
        self.database, self.model = database, model
        self.operations = frozenset(operations)
        self.clock = clock

    async def enqueue(self, *, owner, operation, payload, request_id):
        if operation not in self.operations:
            raise NativeQueueError("native_operation_forbidden")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 200:
            raise NativeQueueError("native_request_id_required")
        checksum = digest({"operation": operation, "payload": payload})
        model = self.model
        async with self.database.sessions() as session:
            bind(session, owner)
            existing = await session.scalar(select(model).where(model.request_id == request_id))
            if existing:
                if existing.payload_sha256 != checksum:
                    raise NativeQueueError("native_request_conflict")
                return snapshot(existing)
            row = model(
                owner_user_id=owner,
                operation=operation,
                payload=payload,
                payload_sha256=checksum,
                request_id=request_id,
            )
            session.add(row)
            try:
                await session.commit()
                return snapshot(row)
            except IntegrityError:
                await session.rollback()
                existing = await session.scalar(select(model).where(model.request_id == request_id))
                if existing is None or existing.payload_sha256 != checksum:
                    raise NativeQueueError("native_request_conflict") from None
                return snapshot(existing)

    async def get(self, *, owner, job_id):
        model = self.model
        async with self.database.sessions() as session:
            bind(session, owner)
            row = await session.get(model, job_id)
            if row is None:
                raise NativeQueueError("native_job_not_found")
            now = self.clock()
            if row.status == "leased" and row.lease_expires_at <= now:
                await session.execute(
                    update(model)
                    .where(
                        model.id == row.id,
                        model.status == "leased",
                        model.revision == row.revision,
                        model.lease_expires_at <= now,
                    )
                    .values(
                        status="unknown",
                        error_code="worker_lease_expired",
                        message="原生执行结果未确认；不会自动重派",
                        revision=model.revision + 1,
                        updated_at=now,
                    )
                )
                await session.commit()
                row = await session.get(model, job_id, populate_existing=True)
            return snapshot(row)

    async def claim(self, *, worker_id, allowed_operations):
        allowed = self.operations.intersection(allowed_operations)
        if not allowed:
            return None
        model = self.model
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            row = await session.scalar(
                select(model)
                .where(model.status == "queued", model.operation.in_(sorted(allowed)))
                .order_by(model.created_at, model.id)
                .limit(1)
            )
            if row is None:
                return None
            bind(session, row.owner_user_id)
            nonce = str(uuid4())
            expiry = self.clock() + timedelta(seconds=90)
            claimed = await session.execute(
                update(model)
                .where(model.id == row.id, model.status == "queued", model.revision == row.revision)
                .values(
                    worker_id=worker_id,
                    lease_id=nonce,
                    lease_expires_at=expiry,
                    status="leased",
                    revision=model.revision + 1,
                    updated_at=self.clock(),
                )
            )
            await session.commit()
            if claimed.rowcount != 1:
                return None
            return NativeLease(
                job_id=row.id,
                lease_id=nonce,
                owner_user_id=row.owner_user_id,
                operation=row.operation,
                payload=row.payload,
                lease_expires_at=expiry.isoformat(),
            )

    async def heartbeat(self, *, worker_id, lease):
        model = self.model
        async with self.database.sessions() as session:
            bind(session, lease.owner_user_id)
            result = await session.execute(
                update(model)
                .where(
                    model.id == str(lease.job_id),
                    model.worker_id == worker_id,
                    model.lease_id == str(lease.lease_id),
                    model.status == "leased",
                )
                .values(
                    lease_expires_at=self.clock() + timedelta(seconds=90),
                    revision=model.revision + 1,
                    updated_at=self.clock(),
                )
            )
            await session.commit()
            return result.rowcount == 1

    async def complete(self, *, worker_id, lease, outcome: NativeOutcome, allowed_operations):
        if lease.operation not in self.operations.intersection(allowed_operations):
            raise NativeQueueError("native_operation_forbidden")
        checksum = digest(outcome.model_dump(mode="json"))
        model = self.model
        async with self.database.sessions() as session:
            bind(session, lease.owner_user_id)
            result = await session.execute(
                update(model)
                .where(
                    model.id == str(lease.job_id),
                    model.worker_id == worker_id,
                    model.lease_id == str(lease.lease_id),
                    model.operation == lease.operation,
                    model.outcome_sha256.is_(None),
                    model.status.in_(("leased", "unknown")),
                )
                .values(
                    status=outcome.status,
                    result=outcome.result,
                    error_code=outcome.error_code,
                    message=outcome.message,
                    outcome_sha256=checksum,
                    revision=model.revision + 1,
                    updated_at=self.clock(),
                )
            )
            await session.commit()
            if result.rowcount == 1:
                return True
            row = await session.get(model, str(lease.job_id), populate_existing=True)
            if (
                row
                and row.worker_id == worker_id
                and row.lease_id == str(lease.lease_id)
                and row.outcome_sha256 == checksum
            ):
                return True
            raise NativeQueueError("native_receipt_conflict")

    async def wait(self, *, owner, job_id, timeout=35):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = await self.get(owner=owner, job_id=job_id)
            if value["status"] not in {"queued", "leased"}:
                return value
            await asyncio.sleep(0.15)
        raise NativeQueueError("native_worker_unavailable")
