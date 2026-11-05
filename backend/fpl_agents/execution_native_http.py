"""Dedicated credentials and private protocol for workbench execution leases."""

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from fpl_runtime.native_protocol import NativeLease, NativeOutcome

PREFIX = "/_native/v1/execution"
router = APIRouter(prefix=PREFIX, include_in_schema=False)


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
    host, worker = request.app.state.execution_discovery, request.state.native_worker.id
    lease = await host.claim(worker)
    if lease is None and body.wait_seconds:
        await asyncio.sleep(body.wait_seconds)
        lease = await host.claim(worker)
    return {"lease": lease}


@router.post("/authorize")
async def authorize(request: Request, body: Leased):
    await request.app.state.execution_discovery.authorize(
        request.state.native_worker.id, body.lease
    )
    return {"active": True}


@router.post("/receipt")
async def receipt(request: Request, body: Receipt):
    await request.app.state.execution_discovery.settle(
        request.state.native_worker.id, body.lease, body.outcome
    )
    return {"acknowledged": True}
