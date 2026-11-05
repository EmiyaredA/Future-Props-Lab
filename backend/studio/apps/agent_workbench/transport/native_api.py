"""Private, versioned collector protocol. No browser or SDK credential is accepted."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, JsonValue

from studio.apps.agent_workbench.authorization import checkpoint_snapshot, see_worker, verify_follow
from studio.apps.agent_workbench.projection import project_frame
from studio.apps.agent_workbench.status import report_cycle
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.runtime.tasks.native_queue import NativeQueueError
from studio.runtime.time import utc_now

router = APIRouter(prefix="/_native/v1")


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: int = Field(default=20, ge=0, le=25)
    operations: list[str] | None = Field(default=None, max_length=20)


class Receipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease
    outcome: NativeOutcome


class LeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Projection(LeaseRequest):
    frame_id: UUID
    locator: str = Field(min_length=1, max_length=8192)
    expected: dict[str, JsonValue]
    batch: dict[str, JsonValue]


class Cycle(LeaseRequest):
    locators: list[str] = Field(max_length=100000)
    errors: dict[str, str] = Field(default_factory=dict, max_length=100000)
    incomplete: bool = False
    native_events: bool = False


def worker(request):
    value = getattr(request.state, "native_worker", None)
    if value is None:
        raise HTTPException(403, "native_worker_required")
    return value


@router.post("/claim")
async def claim(request: Request, body: Claim):
    import asyncio
    import time

    actor = worker(request)
    app = request.app.state
    await see_worker(app.database, actor, utc_now())
    deadline = time.monotonic() + body.wait_seconds
    while True:
        value = await app.native_queue.claim(
            worker_id=actor.id,
            allowed_operations=actor.operations.intersection(body.operations)
            if body.operations is not None
            else actor.operations,
        )
        if value is not None:
            return {"lease": value.model_dump(mode="json")}
        if time.monotonic() >= deadline or await request.is_disconnected():
            return {"lease": None}
        await asyncio.sleep(0.3)


@router.post("/receipt")
async def receipt(request: Request, body: Receipt):
    actor = worker(request)
    try:
        await request.app.state.native_queue.complete(
            worker_id=actor.id,
            lease=body.lease,
            outcome=body.outcome,
            allowed_operations=actor.operations,
        )
    except NativeQueueError as exc:
        raise HTTPException(409, exc.code) from exc
    return {"acknowledged": True}


@router.post("/snapshot")
async def snapshot(request: Request, body: LeaseRequest):
    actor = worker(request)
    app = request.app.state
    context = await verify_follow(app.database, app.identity, actor, body.lease)
    return await checkpoint_snapshot(app.database, context)


@router.post("/heartbeat")
async def heartbeat(request: Request, body: LeaseRequest):
    actor = worker(request)
    app = request.app.state
    await see_worker(app.database, actor, utc_now())
    if body.lease.operation == "agent_sources.follow":
        await verify_follow(app.database, app.identity, actor, body.lease)
    active = await app.native_queue.heartbeat(worker_id=actor.id, lease=body.lease)
    return {"active": active}


@router.post("/projection")
async def projection(request: Request, body: Projection):
    actor = worker(request)
    app = request.app.state
    context = await verify_follow(app.database, app.identity, actor, body.lease)
    applied = await project_frame(
        app.database,
        context,
        lease=body.lease,
        frame_id=body.frame_id,
        locator=body.locator,
        expected=body.expected,
        value=body.batch,
    )
    return {"applied": applied}


@router.post("/cycle")
async def cycle(request: Request, body: Cycle):
    actor = worker(request)
    app = request.app.state
    context = await verify_follow(app.database, app.identity, actor, body.lease)
    await report_cycle(
        app.database,
        context,
        job_id=str(body.lease.job_id),
        locators=body.locators,
        errors=body.errors,
        incomplete=body.incomplete,
        native_events=body.native_events,
    )
    return {"acknowledged": True}
