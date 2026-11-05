"""Admit a native Finder action only while its local browser request is live."""

from time import monotonic
from uuid import uuid4

from anyio import CancelScope
from fastapi import HTTPException
from sqlalchemy import select, update

from app.runtime.time import utc_now
from fpl_runtime.amadeus_native import FINDER, FinderScope
from fpl_runtime.native_queue import NativeQueue, NativeQueueError

from .models import AmadeusNativeJob

WINDOW = 8
ERRORS = {"authorization_revoked": 403, "folder_missing": 409, "folder_open_unavailable": 503}


class AmadeusHost:
    def __init__(self, database, identity):
        self.database, self.identity = database, identity
        self.queue = NativeQueue(database, AmadeusNativeJob, operations={FINDER}, clock=utc_now)
        self.requests = {}
        self.workers = {}

    def current_worker(self, worker):
        return monotonic() - self.workers.get(worker, (float("-inf"), False))[0] < 12

    @property
    def ready(self):
        return any(self.current_worker(worker) for worker in self.workers)

    @property
    def sandbox(self):
        return any(
            enabled and self.current_worker(worker) for worker, (_, enabled) in self.workers.items()
        )

    async def open(self, owner, scope: FinderScope, assertion):
        if not self.ready:
            raise HTTPException(503, "amadeus_mac_worker_unavailable")
        status = await self.identity.status(assertion=assertion, method="POST", path=scope.path)
        if status is not True:
            raise HTTPException(503 if status is None else 403, "folder_open_authorization_ended")
        if len(self.requests) >= 32:
            raise HTTPException(503, "amadeus_mac_worker_busy")
        request_id = uuid4().hex
        self.requests[owner, request_id] = assertion
        job = outcome = None
        try:
            job = await self.queue.enqueue(
                owner=owner,
                operation=FINDER,
                payload=scope.model_dump(mode="json"),
                request_id=request_id,
            )
            outcome = await self.queue.wait(owner=owner, job_id=job["id"], timeout=WINDOW)
        except NativeQueueError:
            raise HTTPException(503, "folder_open_unconfirmed") from None
        finally:
            self.requests.pop((owner, request_id), None)
            if job is not None and outcome is None:
                with CancelScope(shield=True):
                    await self.discard(owner, job["id"])
        if outcome["status"] == "completed":
            return
        code = outcome["error_code"]
        raise HTTPException(
            ERRORS.get(code, 503), {"code": code, "message": "无法确认会话目录已打开"}
        )

    async def recover(self):
        model = AmadeusNativeJob
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            owners = await session.scalars(
                select(model.owner_user_id).where(model.status.in_(("queued", "leased"))).distinct()
            )
        for owner in owners:
            await self.discard(owner)

    async def discard(self, owner, identity=None):
        model = AmadeusNativeJob
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            scope = update(model).where(model.id == identity) if identity else update(model)
            for previous, status in (("queued", "failed"), ("leased", "unknown")):
                await session.execute(
                    scope.where(model.status == previous).values(
                        status=status,
                        error_code="native_request_ended",
                        revision=model.revision + 1,
                        updated_at=utc_now(),
                    )
                )
            await session.commit()

    async def claim(self, worker, sandbox):
        self.workers[worker] = (monotonic(), sandbox)
        return await self.queue.claim(worker_id=worker, allowed_operations={FINDER})

    async def match(self, worker, lease, *, active):
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as session:
            row = await session.get(AmadeusNativeJob, str(lease.job_id))
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.payload != lease.payload
                or (active and (row.status != "leased" or row.lease_expires_at <= utc_now()))
            ):
                raise HTTPException(410, "amadeus_native_lease_ended")
            return row.request_id

    async def authorize(self, worker, lease):
        request_id = await self.match(worker, lease, active=True)
        token = self.requests.get((lease.owner_user_id, request_id))
        if token is None or not await self.identity.active(
            assertion=token, method="POST", path=FinderScope.model_validate(lease.payload).path
        ):
            raise HTTPException(403, "folder_open_authorization_ended")
        if self.requests.get((lease.owner_user_id, request_id)) != token:
            raise HTTPException(403, "folder_open_authorization_ended")

    async def settle(self, worker, lease, outcome):
        await self.match(worker, lease, active=False)
        if outcome.status == "completed" and (
            set(outcome.result) != {"opened"} or outcome.result["opened"] is not True
        ):
            raise HTTPException(422, "folder_open_receipt_invalid")
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations={FINDER}
            )
        except NativeQueueError:
            raise HTTPException(409, "folder_open_receipt_changed") from None
