"""Native worker protocol on the separately authenticated loopback listener."""

import asyncio
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.runtime.tasks.native_queue import NativeQueueError

from .contracts import HOST_OPERATIONS, HostState
from .operations import report, validate_lease

router = APIRouter(prefix="/_native/v1")


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: int = Field(default=1, ge=0, le=20)


class LeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(LeaseRequest):
    outcome: NativeOutcome


class NativeTransport:
    def __init__(self, app, *, ingress_token, workers):
        if (
            len(ingress_token) < 32
            or not workers
            or any(len(value) < 32 for value in workers.values())
        ):
            raise ValueError("管理 worker 必须使用独立强凭据")
        self.app, self.ingress, self.workers = app, ingress_token, dict(workers)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        worker = next(
            (
                key
                for key, value in self.workers.items()
                if secrets.compare_digest(
                    headers.get("authorization", "").removeprefix("Bearer "), value
                )
            ),
            None,
        )
        if not worker or not secrets.compare_digest(
            headers.get("x-fpl-native-ingress", ""), self.ingress
        ):
            await JSONResponse({"code": "native_worker_required"}, 403)(scope, receive, send)
            return
        scope = {**scope, "state": {**scope.get("state", {}), "native_worker": worker}}
        await self.app(scope, receive, send)


@router.post("/claim")
async def claim(request: Request, body: Claim):
    worker = request.state.native_worker
    for _ in range(body.wait_seconds * 4 + 1):
        lease = await request.app.state.native_queue.claim(
            worker_id=worker, allowed_operations=HOST_OPERATIONS
        )
        if lease:
            try:
                await validate_lease(request.app.state, worker, lease)
            except HTTPException:
                await request.app.state.native_queue.complete(
                    worker_id=worker,
                    lease=lease,
                    outcome=NativeOutcome(status="failed", error_code="authorization_revoked"),
                    allowed_operations=HOST_OPERATIONS,
                )
                continue
            return {"lease": lease.model_dump(mode="json")}
        await asyncio.sleep(0.25)
    return {"lease": None}


@router.post("/authorize")
async def authorize_execution(request: Request, body: LeaseRequest):
    await validate_lease(request.app.state, request.state.native_worker, body.lease)
    return {"active": True}


@router.post("/receipt")
async def receipt(request: Request, body: Receipt):
    try:
        await request.app.state.native_queue.complete(
            worker_id=request.state.native_worker,
            lease=body.lease,
            outcome=body.outcome,
            allowed_operations=HOST_OPERATIONS,
        )
    except NativeQueueError as exc:
        raise HTTPException(409, exc.code) from exc
    return {"acknowledged": True}


@router.post("/report")
async def report_state(request: Request, body: HostState):
    await report(request.app.state.database, body)
    return {"acknowledged": True}


@router.post("/heartbeat")
async def heartbeat(request: Request, body: LeaseRequest):
    await validate_lease(request.app.state, request.state.native_worker, body.lease)
    active = await request.app.state.native_queue.heartbeat(
        worker_id=request.state.native_worker, lease=body.lease
    )
    if not active:
        raise HTTPException(410, "management_lease_ended")
    return {"active": True}
