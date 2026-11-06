"""Keep local setup authorization live through a narrowly leased Mac request."""

from time import monotonic
from uuid import uuid4

from anyio import CancelScope
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import update

from studio.apps.remote_desktop.storage.service_models import RemoteSetupJob
from studio.contracts.remote_desktop.desktop import CloudSetup
from studio.contracts.remote_desktop.setup import OPERATIONS, READ, SAVE, SETTINGS_PATH
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError
from studio.runtime.time import utc_now

WINDOW = 15
ERROR_STATUS = {
    "authorization_revoked": 403,
    "setup_forbidden": 403,
    "configuration_conflict": 409,
    "invalid_setup": 422,
}


class SetupHost:
    def __init__(self, database, identity):
        self.database, self.identity = database, identity
        self.queue = NativeQueue(database, RemoteSetupJob, operations=OPERATIONS, clock=utc_now)
        self.live = {}
        self.last_poll = None

    @property
    def ready(self):
        return self.last_poll is not None and monotonic() - self.last_poll < 15

    async def run(self, request, owner, body=None):
        method = request.method
        if (method, request.url.path) not in {
            ("GET", SETTINGS_PATH),
            ("PUT", SETTINGS_PATH),
        } or not request.state.service_actor.local:
            raise HTTPException(403, "cloud_setup_local_required")
        if not self.ready or len(self.live) >= 32:
            raise HTTPException(503, "云控配置协调器尚未就绪")
        operation = SAVE if method == "PUT" else READ
        token = request.state.service_assertion
        active = await self.identity.cloud_authority(
            assertion=token, method=method, path=SETTINGS_PATH
        )
        if active is None:
            raise HTTPException(503, "云控身份服务暂不可用")
        if not active.active:
            raise HTTPException(403, "云控会话已失效")
        request_id = uuid4().hex
        key = owner, request_id
        self.live[key] = token
        row, result = None, None
        try:
            row = await self.queue.enqueue(
                owner=owner,
                operation=operation,
                request_id=request_id,
                payload=body.model_dump(mode="json") if body is not None else {},
            )
            result = await self.queue.wait(owner=owner, job_id=row["id"], timeout=WINDOW)
        except NativeQueueError:
            raise HTTPException(503, "云控设置结果未确认，请重新读取配置") from None
        finally:
            self.live.pop(key, None)
            if row is not None and result is None:
                with CancelScope(shield=True):
                    await self.discard_queued(owner, row["id"])
        if result["status"] == "completed":
            return CloudSetup.model_validate(result["result"])
        raise HTTPException(
            ERROR_STATUS.get(result["error_code"], 503),
            {"code": result["error_code"], "message": result["message"] or "云控设置未确认"},
        )

    async def discard_queued(self, owner, job_id):
        row = RemoteSetupJob
        async with self.database.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(
                update(row)
                .where(row.id == job_id, row.status == "queued")
                .values(
                    status="failed",
                    error_code="native_request_ended",
                    revision=row.revision + 1,
                    updated_at=utc_now(),
                )
            )
            await db.commit()

    async def claim(self, worker):
        self.last_poll = monotonic()
        return await self.queue.claim(worker_id=worker, allowed_operations=OPERATIONS)

    async def match_lease(self, worker, lease, *, active):
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as db:
            row = await db.get(RemoteSetupJob, str(lease.job_id))
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.payload != lease.payload
                or (active and (row.status != "leased" or row.lease_expires_at <= utc_now()))
            ):
                raise HTTPException(410, "cloud_setup_lease_ended")
            return row.request_id

    async def authorize(self, worker, lease):
        request_id = await self.match_lease(worker, lease, active=True)
        token = self.live.get((lease.owner_user_id, request_id))
        if token is None:
            raise HTTPException(403, "cloud_setup_authority_ended")
        result = await self.identity.cloud_authority(
            assertion=token, method="GET" if lease.operation == READ else "PUT", path=SETTINGS_PATH
        )
        if result is None or not result.active:
            raise HTTPException(403, "cloud_setup_authority_ended")
        return {"active": True}

    async def settle(self, worker, lease, outcome):
        await self.match_lease(worker, lease, active=False)
        if outcome.status == "completed":
            try:
                result = outcome.result.copy()
                # Accept receipts written before the enrollment field was retired.
                if isinstance(result.get("enrolled"), bool):
                    del result["enrolled"]
                value = CloudSetup.model_validate(result)
                if value.model_dump(mode="json") != result:
                    raise ValueError("unexpected setup data")
            except (ValueError, ValidationError):
                raise HTTPException(422, "cloud_setup_receipt_invalid") from None
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations=OPERATIONS
            )
        except NativeQueueError:
            raise HTTPException(409, "cloud_setup_receipt_changed") from None
