"""Accept evidence for one authenticated execution attempt; never resubmit work."""

import hashlib
import json
from dataclasses import dataclass
from typing import Protocol

from studio.apps.agent_workbench.rules.turn_endings import Ending, completion
from studio.contracts.agent_workbench.execution import RUN_TURN, TurnScope
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome


def canonical(value) -> str:
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    )


class ReceiptError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class TurnReceipt:
    owner: str
    worker: str
    job_id: str
    lease_id: str
    payload: str
    chat_id: str
    turn_id: str
    checksum: str
    status: str
    error_code: str


@dataclass(frozen=True)
class ReceiptState:
    worker: str
    lease_id: str
    operation: str
    payload: str
    checksum: str | None
    job_status: str
    turn_status: str


@dataclass(frozen=True)
class Settlement:
    duplicate: bool
    ending: Ending | None


def decide(receipt: TurnReceipt, current: ReceiptState | None) -> Settlement:
    """Must run against the same locked snapshot that will be committed.

    Expiry prevents new actions, not reconciliation of the original attempt. A receipt
    may settle an unknown job, but it cannot replace a receipt or revive an ended turn.
    """
    if current is None or (
        current.worker != receipt.worker
        or current.lease_id != receipt.lease_id
        or current.operation != RUN_TURN
        or current.payload != receipt.payload
    ):
        raise ReceiptError("workbench_execution_lease_ended")
    if current.checksum == receipt.checksum:
        return Settlement(True, None)
    if current.checksum is not None or current.job_status not in {"leased", "unknown"}:
        raise ReceiptError("workbench_turn_receipt_conflict")
    error = None if receipt.status == "completed" else "Agent 运行未完成，请核对结果后继续"
    return Settlement(False, completion(current.turn_status, receipt.status, error))


class TurnSettlementStore(Protocol):
    async def commit_receipt(self, receipt: TurnReceipt) -> Settlement:
        """Bind owner; validate attempt, receipt and turn in one short transaction.

        Persist receipt, ending, pending-action resolution and queue pause atomically.
        A duplicate is a successful no-op; an unknown commit must be reconciled with
        this exact receipt, never by creating another execution. Cancellation rolls
        back all writes; the store must not perform network or filesystem I/O.
        """
        ...


class SettleTurn:
    def __init__(self, store: TurnSettlementStore):
        self.store = store

    async def execute(self, worker: str, lease: NativeLease, outcome: NativeOutcome) -> Settlement:
        if lease.operation != RUN_TURN or outcome.result:
            raise ReceiptError("workbench_turn_receipt_invalid")
        scope = TurnScope.model_validate(lease.payload)
        receipt = TurnReceipt(
            owner=lease.owner_user_id,
            worker=worker,
            job_id=str(lease.job_id),
            lease_id=str(lease.lease_id),
            payload=canonical(lease.payload),
            chat_id=scope.chat_id,
            turn_id=scope.turn_id,
            checksum=hashlib.sha256(
                canonical(outcome.model_dump(mode="json")).encode()
            ).hexdigest(),
            status=outcome.status,
            error_code=outcome.error_code,
        )
        return await self.store.commit_receipt(receipt)
