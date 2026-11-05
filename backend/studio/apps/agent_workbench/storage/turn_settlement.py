"""Atomic native receipt, turn ending and queue pause in the owned Agents database."""

from sqlalchemy import select, text

from studio.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchTurn
from studio.apps.agent_workbench.execution.transcripts import end_turn
from studio.apps.agent_workbench.storage.service_models import WorkbenchExecutionJob
from studio.apps.agent_workbench.use_cases.settle_turn import (
    ReceiptError,
    ReceiptState,
    Settlement,
    TurnReceipt,
    canonical,
    decide,
)


class SqlTurnSettlement:
    def __init__(self, sessions):
        self.sessions = sessions

    async def commit_receipt(self, receipt: TurnReceipt) -> Settlement:
        async with self.sessions(info={"owner_user_id": receipt.owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            job = await db.scalar(
                select(WorkbenchExecutionJob).where(
                    WorkbenchExecutionJob.id == receipt.job_id,
                    WorkbenchExecutionJob.owner_user_id == receipt.owner,
                )
            )
            if job is None:
                raise ReceiptError("workbench_execution_lease_ended")
            turn = await db.scalar(
                select(WorkbenchTurn).where(
                    WorkbenchTurn.id == receipt.turn_id,
                    WorkbenchTurn.chat_id == receipt.chat_id,
                    WorkbenchTurn.owner_user_id == receipt.owner,
                )
            )
            if turn is None:
                raise ReceiptError("workbench_execution_lease_ended")
            result = decide(
                receipt,
                ReceiptState(
                    job.worker_id,
                    job.lease_id,
                    job.operation,
                    canonical(job.payload),
                    job.outcome_sha256,
                    job.status,
                    turn.status,
                ),
            )
            if result.duplicate:
                return result
            job.outcome_sha256, job.status = receipt.checksum, receipt.status
            job.error_code = receipt.error_code
            job.revision += 1
            if result.ending is not None:
                end_turn(turn, result.ending.status, result.ending.error)
                if result.ending.status != "completed":
                    chat = await db.scalar(
                        select(WorkbenchChat).where(
                            WorkbenchChat.id == receipt.chat_id,
                            WorkbenchChat.owner_user_id == receipt.owner,
                        )
                    )
                    if chat is None:
                        raise ReceiptError("workbench_execution_lease_ended")
                    chat.queue_paused = True
            await db.commit()
            return result
