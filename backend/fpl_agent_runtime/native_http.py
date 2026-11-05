"""Private native admission for a registered worker and fixed connection leases."""

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from fpl_runtime.native_protocol import NativeLease, NativeOutcome

router = APIRouter(prefix="/_native/v1", include_in_schema=False)


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
