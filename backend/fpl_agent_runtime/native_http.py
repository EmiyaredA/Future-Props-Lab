"""Private native admission for a registered worker and fixed connection leases."""

import asyncio
import secrets

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from fpl_runtime.native_protocol import NativeLease, NativeOutcome

router = APIRouter(prefix="/_native/v1", include_in_schema=False)


class NativeIngress:
    def __init__(self, app, *, options):
        self.app, self.options = app, options

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        worker = None
        if (
            self.options is not None
            and "origin" not in headers
            and "cookie" not in headers
            and secrets.compare_digest(
                headers.get("x-fpl-native-ingress", "").encode(), self.options.ingress.encode()
            )
            and headers.get("authorization", "").startswith("Bearer ")
        ):
            token = headers["authorization"][7:].encode()
            worker = next(
                (
                    key
                    for key, value in self.options.workers.items()
                    if secrets.compare_digest(token, value.encode())
                ),
                None,
            )
        if worker is None:
            await JSONResponse(
                {"code": "native_worker_required"}, 403, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)
            return
        state = {**scope.get("state", {}), "connection_worker": worker}
        await self.app({**scope, "state": state}, receive, send)


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: float = Field(default=1, ge=0, le=4)


class Lease(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(Lease):
    outcome: NativeOutcome


@router.post("/claim")
async def claim(request: Request, body: Claim):
    host = request.app.state.connections
    lease = await host.claim(request.state.connection_worker)
    if lease is None and body.wait_seconds:
        await asyncio.sleep(body.wait_seconds)
        lease = await host.claim(request.state.connection_worker)
    return {"lease": lease}


@router.post("/authorize")
async def authorize(request: Request, body: Lease):
    await request.app.state.connections.authorize(request.state.connection_worker, body.lease)
    return {"active": True}


@router.post("/receipt")
async def receive_receipt(request: Request, body: Receipt):
    await request.app.state.connections.settle(
        request.state.connection_worker, body.lease, body.outcome
    )
    return {"acknowledged": True}
