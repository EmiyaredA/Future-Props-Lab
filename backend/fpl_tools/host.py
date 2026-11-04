"""Account- and session-bound queue for the single local library reveal operation."""

from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update

from app.runtime.time import utc_now
from fpl_runtime.native_protocol import NativeOutcome
from fpl_runtime.native_queue import NativeQueue, NativeQueueError
from fpl_runtime.tools_native import ERRORS, HOST_OPERATIONS, OPEN_LIBRARY, OPEN_PATH

from .models import ToolsNativeJob

WINDOW_SECONDS = 8


class ToolsHost:
    def __init__(self, database, identity):
        self.database, self.identity = database, identity
        self.queue = NativeQueue(
            database, ToolsNativeJob, operations=HOST_OPERATIONS, clock=utc_now
        )

    async def _live(self, assertion):
        return await self.identity.status(assertion=assertion, method="POST", path=OPEN_PATH)

    async def open_library(self, owner, assertion):
        active = await self._live(assertion)
        if active is not True:
            raise HTTPException(
                503 if active is None else 403,
                {"code": "folder_open_unavailable" if active is None else "authorization_revoked"},
            )
        deadline = utc_now() + timedelta(seconds=WINDOW_SECONDS)
        job = await self.queue.enqueue(
            owner=owner,
            operation=OPEN_LIBRARY,
            payload={"assertion": assertion, "deadline": deadline.isoformat()},
            request_id=uuid4().hex,
        )
        try:
            result = await self.queue.wait(owner=owner, job_id=job["id"], timeout=WINDOW_SECONDS)
        except NativeQueueError as exc:
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(ToolsNativeJob)
                    .where(ToolsNativeJob.id == job["id"], ToolsNativeJob.status == "queued")
                    .values(
                        status="failed",
                        error_code="folder_open_unavailable",
                        revision=ToolsNativeJob.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                await session.commit()
            raise HTTPException(
                503,
                {
                    "code": "folder_open_unavailable",
                    "message": ERRORS["folder_open_unavailable"][1],
                },
            ) from exc
        if result["status"] == "completed" and result["result"] == {"opened": True}:
            return
        code = result["error_code"]
        if code not in ERRORS:
            code = "folder_open_unavailable"
        status, message = ERRORS[code]
        raise HTTPException(status, {"code": code, "message": message})

    async def authorize(self, worker, lease):
        if lease.operation not in HOST_OPERATIONS or lease.payload:
            raise HTTPException(403, "native_operation_forbidden")
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as session:
            row = await session.scalar(
                select(ToolsNativeJob).where(ToolsNativeJob.id == str(lease.job_id))
            )
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.status != "leased"
                or row.lease_expires_at <= utc_now()
            ):
                raise HTTPException(410, "tools_lease_ended")
            assertion = row.payload["assertion"]
            deadline = datetime.fromisoformat(row.payload["deadline"])
        if deadline <= utc_now() or not await self._live(assertion) or deadline <= utc_now():
            raise HTTPException(410, "tools_authorization_ended")

    async def claim(self, worker):
        lease = await self.queue.claim(worker_id=worker, allowed_operations=HOST_OPERATIONS)
        if lease is None:
            return None
        sanitized = lease.model_copy(update={"payload": {}})
        try:
            await self.authorize(worker, sanitized)
        except HTTPException:
            await self.finish(
                worker,
                sanitized,
                NativeOutcome(status="failed", error_code="authorization_revoked"),
            )
            return None
        return sanitized

    async def finish(self, worker, lease, outcome):
        if lease.payload or (outcome.status == "completed" and outcome.result != {"opened": True}):
            raise HTTPException(422, "tools_outcome_invalid")
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations=HOST_OPERATIONS
            )
        except NativeQueueError as exc:
            raise HTTPException(409, exc.code) from exc
