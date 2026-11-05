"""Dedicated credentials and private protocol for workbench execution leases."""

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from studio.apps.agent_workbench.use_cases.settle_turn import ReceiptError
from studio.contracts.agent_workbench.execution import (
    InstructionReceipt,
    Leased,
    TurnActivity,
    TurnAnswer,
    TurnApproval,
    TurnApprovalReceipt,
    TurnProposal,
)
from studio.contracts.agent_workbench.native import NativeOutcome

PREFIX = "/_native/v1/execution"
router = APIRouter(prefix=PREFIX, include_in_schema=False)


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: float = Field(default=1, ge=0, le=4)


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


@router.post("/turns/claim")
async def claim_turn(request: Request, body: Claim):
    host, worker = request.app.state.execution_turns, request.state.native_worker.id
    lease = await host.claim(worker)
    if lease is None and body.wait_seconds:
        await asyncio.sleep(body.wait_seconds)
        lease = await host.claim(worker)
    return {"lease": lease}


@router.post("/turns/heartbeat")
async def turn_heartbeat(request: Request, body: Leased):
    await request.app.state.execution_turns.heartbeat(request.state.native_worker.id, body.lease)
    return {"active": True}


@router.post("/turns/conversation")
async def turn_conversation(request: Request, body: Leased):
    return await request.app.state.execution_turns.conversation(
        request.state.native_worker.id, body.lease
    )


@router.post("/turns/answer")
async def turn_answer(request: Request, body: TurnAnswer):
    await request.app.state.execution_turns.answer(
        request.state.native_worker.id, body.lease, body.text
    )
    return {"acknowledged": True}


@router.post("/turns/activity")
async def turn_activity(request: Request, body: TurnActivity):
    await request.app.state.execution_turns.activity(request.state.native_worker.id, body)
    return {"acknowledged": True}


@router.post("/turns/approvals/propose")
async def propose_turn_approval(request: Request, body: TurnProposal):
    return await request.app.state.execution_turns.approval(
        request.state.native_worker.id, body, "propose"
    )


@router.post("/turns/approvals/reserve")
async def reserve_turn_approval(request: Request, body: TurnApproval):
    return await request.app.state.execution_turns.approval(
        request.state.native_worker.id, body, "reserve"
    )


@router.post("/turns/approvals/receipt")
async def receipt_turn_approval(request: Request, body: TurnApprovalReceipt):
    return await request.app.state.execution_turns.approval(
        request.state.native_worker.id, body, "settle"
    )


@router.post("/turns/receipt")
async def turn_receipt(request: Request, body: Receipt):
    try:
        await request.app.state.execution_turns.settle(
            request.state.native_worker.id, body.lease, body.outcome
        )
    except ReceiptError as exc:
        status = {
            "workbench_turn_receipt_invalid": 422,
            "workbench_execution_lease_ended": 410,
            "workbench_turn_receipt_conflict": 409,
        }[exc.code]
        raise HTTPException(status, exc.code) from None
    return {"acknowledged": True}


@router.post("/turns/instructions/claim")
async def claim_instruction(request: Request, body: Leased):
    instruction = await request.app.state.execution_turns.instructions.claim(
        request.state.native_worker.id, body.lease
    )
    return {"instruction": instruction}


@router.post("/turns/instructions/receipt")
async def receipt_instruction(request: Request, body: InstructionReceipt):
    await request.app.state.execution_turns.instructions.settle(
        request.state.native_worker.id, body
    )
    return {"acknowledged": True}
