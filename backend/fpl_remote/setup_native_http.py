"""Receive only authenticated Mac leases for the two settings operations."""

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from fpl_runtime.native_protocol import NativeLease, NativeOutcome

router = APIRouter(prefix="/_native/v1", include_in_schema=False)


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: float = Field(default=1, ge=0, le=4)


class Leased(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(Leased):
    outcome: NativeOutcome


@router.post("/claim")
async def claim(request: Request, body: Claim):
    setup = request.app.state.cloud_setup
    worker = request.state.remote_worker
    lease = await setup.claim(worker)
    if lease is None and body.wait_seconds:
        await asyncio.sleep(body.wait_seconds)
        lease = await setup.claim(worker)
    return {"lease": lease}


@router.post("/authorize")
async def authorize(request: Request, body: Leased):
    return await request.app.state.cloud_setup.authorize(request.state.remote_worker, body.lease)


@router.post("/receipt")
async def receipt(request: Request, body: Receipt):
    await request.app.state.cloud_setup.settle(
        request.state.remote_worker, body.lease, body.outcome
    )
    return {"acknowledged": True}
