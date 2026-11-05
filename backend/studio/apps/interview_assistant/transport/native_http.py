"""Only an authenticated Interview worker can obtain or settle a native lease."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.interview_assistant.execution import ExecutionEvent, WorkerStatus

router = APIRouter(prefix="/_native/v1", include_in_schema=False)


class LeaseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lease: NativeLease


class EventBody(LeaseBody):
    event: ExecutionEvent


class ReceiptBody(LeaseBody):
    outcome: NativeOutcome


@router.post("/beat")
async def beat(request: Request, status: WorkerStatus):
    request.app.state.interview_host.beat(request.state.interview_worker, status)
    return {"accepted": True}


@router.post("/claim")
async def claim(request: Request, status: WorkerStatus):
    lease = await request.app.state.interview_host.claim(request.state.interview_worker, status)
    return {"lease": lease}


@router.post("/active")
async def active(request: Request, body: LeaseBody):
    await request.app.state.interview_host.active(request.state.interview_worker, body.lease)
    return {"active": True}


@router.post("/material")
async def material(request: Request, body: LeaseBody):
    return await request.app.state.interview_host.material(
        request.state.interview_worker, body.lease
    )


@router.post("/event")
async def event(request: Request, body: EventBody):
    await request.app.state.interview_host.event(
        request.state.interview_worker, body.lease, body.event
    )
    return {"accepted": True}


@router.post("/receipt")
async def receipt(request: Request, body: ReceiptBody):
    await request.app.state.interview_host.settle(
        request.state.interview_worker, body.lease, body.outcome
    )
    return {"acknowledged": True}
