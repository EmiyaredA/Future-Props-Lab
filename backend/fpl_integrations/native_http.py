"""Authenticated outbound MCP leases; this lane is never exposed by the public gateway."""

import asyncio
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse

from app.runtime.operation_receipts import OperationError
from fpl_runtime.mcp_native import McpHostObservation
from fpl_runtime.native_protocol import NativeLease, NativeOutcome
from fpl_runtime.native_queue import NativeQueueError
from fpl_runtime.request_limit import RequestLimit

router = APIRouter(prefix="/_native/v1", include_in_schema=False)


class LeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(LeaseRequest):
    outcome: NativeOutcome


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: int = Field(default=1, ge=0, le=20)


class NativeMcpTransport:
    def __init__(self, app, *, ingress_token, workers):
        if (
            len(ingress_token) < 32
            or not workers
            or any(len(value) < 32 for value in workers.values())
        ):
            raise ValueError("MCP worker 必须使用独立强凭据")
        self.app, self.ingress, self.workers = app, ingress_token, dict(workers)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        worker = next(
            (
                name
                for name, credential in self.workers.items()
                if secrets.compare_digest(
                    headers.get("authorization", "").removeprefix("Bearer "), credential
                )
            ),
            None,
        )
        if not worker or not secrets.compare_digest(
            headers.get("x-fpl-native-ingress", ""), self.ingress
        ):
            await JSONResponse(
                {"code": "native_worker_required"}, 403, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)
            return
        scope = {**scope, "state": {**scope.get("state", {}), "native_worker": worker}}

        async def private(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, private)


def owner(request):
    return request.app.state.native_mcp


@router.post("/report")
async def report(request: Request, body: McpHostObservation):
    await owner(request).report(request.state.native_worker, body)
    return {"acknowledged": True}


@router.post("/claim")
async def claim(request: Request, body: Claim):
    for attempt in range(body.wait_seconds * 4 + 1):
        lease = await owner(request).claim(request.state.native_worker)
        if lease is not None:
            return {"lease": lease.model_dump(mode="json")}
        if attempt < body.wait_seconds * 4:
            await asyncio.sleep(0.25)
    return {"lease": None}


@router.post("/authorize")
async def authorize(request: Request, body: LeaseRequest):
    await owner(request).authorize(request.state.native_worker, body.lease)
    return {"active": True}


@router.post("/launch")
async def launch(request: Request, body: LeaseRequest):
    return (await owner(request).launch(request.state.native_worker, body.lease)).model_dump(
        mode="json"
    )


@router.post("/heartbeat")
async def heartbeat(request: Request, body: LeaseRequest):
    await owner(request).authorize(request.state.native_worker, body.lease)
    active = await owner(request).queue.heartbeat(
        worker_id=request.state.native_worker, lease=body.lease
    )
    return {"active": active}


@router.post("/receipt")
async def receipt(request: Request, body: Receipt):
    try:
        await owner(request).complete(request.state.native_worker, body.lease, body.outcome)
    except NativeQueueError as exc:
        raise HTTPException(409, exc.code) from None
    return {"acknowledged": True}


def attach_native(app, broker, *, ingress_token, workers):
    app.state.native_mcp = broker
    app.include_router(router)
    app.add_middleware(RequestLimit, prefix="/_native/v1/", maximum=2 * 1024**2)
    app.add_middleware(NativeMcpTransport, ingress_token=ingress_token, workers=workers)

    async def operation_error(_request, exc):
        return JSONResponse(
            {"code": exc.code, "message": str(exc)},
            exc.status,
            headers={"Cache-Control": "no-store"},
        )

    app.add_exception_handler(OperationError, operation_error)
