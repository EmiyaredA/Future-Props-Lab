"""Lease exact native actions while their original account authorization is live."""

from dataclasses import dataclass
from time import monotonic
from uuid import uuid4

from anyio import CancelScope
from fastapi import HTTPException
from sqlalchemy import select, update

from app.runtime.time import utc_now
from fpl_runtime.amadeus_native import FINDER, SCRIPT, FinderScope, ScriptResult, ScriptScope
from fpl_runtime.native_queue import NativeQueue, NativeQueueError

from .models import AmadeusNativeJob

WINDOW = 8
SCRIPT_WINDOW = 135
OPERATIONS = frozenset({FINDER, SCRIPT})
ERRORS = {"authorization_revoked": 403, "folder_missing": 409, "folder_open_unavailable": 503}


@dataclass(frozen=True)
class Authority:
    assertion: str
    path: str
    output: object = None


class AmadeusHost:
    def __init__(self, database, identity):
        self.database, self.identity = database, identity
        self.queue = NativeQueue(database, AmadeusNativeJob, operations=OPERATIONS, clock=utc_now)
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
        outcome = await self.run(owner, FINDER, scope, Authority(assertion, scope.path), WINDOW)
        if outcome["status"] != "completed":
            code = outcome["error_code"]
            raise HTTPException(
                ERRORS.get(code, 503), {"code": code, "message": "无法确认会话目录已打开"}
            )

    async def script(self, owner, scope: ScriptScope, assertion, path, output):
        if path not in {scope.path, scope.path + "/stream"}:
            raise HTTPException(403, "script_authorization_required")
        result = await self.run(
            owner, SCRIPT, scope, Authority(assertion, path, output), SCRIPT_WINDOW
        )
        if not await self.identity.active(assertion=assertion, method="POST", path=path):
            return {"status": "unknown", "error_code": "authorization_revoked"}
        return result

    async def run(self, owner, operation, scope, authority, timeout):
        if not self.ready or (operation == SCRIPT and not self.sandbox):
            raise HTTPException(503, "amadeus_mac_worker_unavailable")
        status = await self.identity.status(
            assertion=authority.assertion, method="POST", path=authority.path
        )
        if status is not True:
            raise HTTPException(503 if status is None else 403, "native_authorization_ended")
        if len(self.requests) >= 32:
            raise HTTPException(503, "amadeus_mac_worker_busy")
        request_id = uuid4().hex
        self.requests[owner, request_id] = authority
        job = outcome = None
        try:
            job = await self.queue.enqueue(
                owner=owner,
                operation=operation,
                payload=scope.model_dump(mode="json"),
                request_id=request_id,
            )
            outcome = await self.queue.wait(owner=owner, job_id=job["id"], timeout=timeout)
        except NativeQueueError:
            raise HTTPException(503, "amadeus_native_outcome_unconfirmed") from None
        finally:
            self.requests.pop((owner, request_id), None)
            if job is not None and outcome is None:
                with CancelScope(shield=True):
                    await self.discard(owner, job["id"])
        return outcome

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
        return await self.queue.claim(
            worker_id=worker, allowed_operations=OPERATIONS if sandbox else {FINDER}
        )

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
        key = lease.owner_user_id, request_id
        authority = self.requests.get(key)
        if authority is None or not await self.identity.active(
            assertion=authority.assertion, method="POST", path=authority.path
        ):
            raise HTTPException(403, "native_authorization_ended")
        if self.requests.get(key) is not authority:
            raise HTTPException(403, "native_authorization_ended")
        self.workers[worker] = (monotonic(), self.workers.get(worker, (0, False))[1])
        return authority

    async def heartbeat(self, worker, lease):
        await self.authorize(worker, lease)
        if not await self.queue.heartbeat(worker_id=worker, lease=lease):
            raise HTTPException(410, "amadeus_native_lease_ended")

    async def output(self, worker, lease, text):
        if lease.operation != SCRIPT:
            raise HTTPException(403, "script_lease_required")
        authority = await self.authorize(worker, lease)
        if authority.output is not None:
            authority.output(text)

    async def settle(self, worker, lease, outcome):
        await self.match(worker, lease, active=False)
        if outcome.status == "completed":
            if lease.operation == FINDER and (
                set(outcome.result) != {"opened"} or outcome.result["opened"] is not True
            ):
                raise HTTPException(422, "folder_open_receipt_invalid")
            if lease.operation == SCRIPT:
                try:
                    ScriptResult.model_validate(outcome.result)
                except ValueError:
                    raise HTTPException(422, "script_receipt_invalid") from None
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations=OPERATIONS
            )
        except NativeQueueError:
            raise HTTPException(409, "amadeus_native_receipt_changed") from None
