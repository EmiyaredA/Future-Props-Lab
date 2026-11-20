"""Atomic admission and at-most-once delivery of owned run instructions."""

import hashlib
import json
from datetime import timedelta

from sqlalchemy import select, update

from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.models import (
    AmadeusMessage,
    AmadeusRun,
    AmadeusRunEvent,
    AmadeusRunInstruction,
)
from studio.contracts.amadeus.conversations import InstructionOut
from studio.contracts.amadeus.instructions import InstructionClaim
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.time import utc_now


def checksum(value):
    return hashlib.sha256(value.encode()).hexdigest()


def ready(run):
    return (
        run.status == "running"
        and run.input_ready_at is not None
        and run.input_ready_at > utc_now() - timedelta(seconds=5)
    )


async def close_instructions(session, run_ids):
    for old, new in (("pending", "rejected"), ("sending", "unknown")):
        await session.execute(
            update(AmadeusMessage)
            .where(
                AmadeusMessage.id.in_(
                    select(AmadeusRunInstruction.message_id).where(
                        AmadeusRunInstruction.run_id.in_(run_ids),
                        AmadeusRunInstruction.status == old,
                    )
                )
            )
            .values(status=new)
        )
        await session.execute(
            update(AmadeusRunInstruction)
            .where(AmadeusRunInstruction.run_id.in_(run_ids), AmadeusRunInstruction.status == old)
            .values(status=new)
        )
    await session.execute(
        update(AmadeusRun).where(AmadeusRun.id.in_(run_ids)).values(input_ready_at=None)
    )


class InstructionRecords:
    def __init__(self, session, principal):
        self.session, self.principal = session, principal

    async def run(self, conversation, identity, *, write=False):
        # A no-op UPDATE takes the SQLite writer lock before reading mutable state.
        # Never hold this transaction across a network or filesystem operation.
        conditions = (
            AmadeusRun.id == identity,
            AmadeusRun.conversation_id == conversation,
            AmadeusRun.owner_user_id == self.principal.user_id,
            AmadeusRun.user_id == self.principal.user_id,
        )
        query = select(AmadeusRun).where(*conditions)
        if write:
            await self.session.execute(
                update(AmadeusRun)
                .where(*conditions)
                .values(input_ready_at=AmadeusRun.input_ready_at)
            )
        row = await self.session.scalar(query.execution_options(populate_existing=True))
        if row is None:
            raise OperationError("运行不存在", "not_found", 404)
        return row

    async def items(self, run_id):
        rows = (
            await self.session.execute(
                select(AmadeusRunInstruction, AmadeusMessage)
                .join(AmadeusMessage, AmadeusMessage.id == AmadeusRunInstruction.message_id)
                .where(
                    AmadeusRunInstruction.run_id == run_id,
                    AmadeusRunInstruction.owner_user_id == self.principal.user_id,
                )
                .order_by(AmadeusRunInstruction.sequence)
            )
        ).all()
        return [
            InstructionOut(
                request_id=item.request_id,
                message_id=message.id,
                text=message.content,
                references=message.references_json,
                status=item.status,
                sequence=item.sequence,
                created_at=item.created_at,
            )
            for item, message in rows
        ]

    async def existing(self, run_id, request_id):
        return await self.session.scalar(
            select(AmadeusRunInstruction).where(
                AmadeusRunInstruction.run_id == run_id,
                AmadeusRunInstruction.owner_user_id == self.principal.user_id,
                AmadeusRunInstruction.request_id == request_id,
            )
        )

    async def create(self, conversation, identity, body):
        await self.session.rollback()
        run = await self.run(conversation, identity, write=True)
        serialized = body.model_dump(mode="json", exclude={"expected_revision", "request_id"})
        digest = checksum(json.dumps(serialized, ensure_ascii=False, sort_keys=True))
        existing = await self.existing(identity, body.request_id)
        if existing:
            if existing.body_sha256 != digest:
                raise OperationError("请求标识已用于其他消息", "instruction_conflict", 409)
            await self.session.rollback()
            return next(x for x in await self.items(identity) if x.request_id == body.request_id)
        pending = await self.session.scalar(
            select(AmadeusRunInstruction.id).where(
                AmadeusRunInstruction.run_id == identity,
                AmadeusRunInstruction.status.in_(("pending", "sending")),
            )
        )
        if not ready(run) or pending:
            raise OperationError(
                "当前运行暂不能接收补充，请保留输入稍后再试", "input_not_ready", 409
            )
        message = await Conversations(self.session, self.principal).append_run_message(
            conversation,
            identity,
            body.expected_revision,
            body.text,
            serialized["references"],
        )
        message_id, now = message.id, message.created_at
        sequence = run.last_event_sequence + 1
        prompt_input = {
            **serialized,
            "references": [
                {key: value for key, value in ref.items() if key != "thumbnail"}
                for ref in serialized["references"]
            ],
        }
        prompt = "用户补充要求（保持当前模式、权限及审批规则）：\n" + json.dumps(
            prompt_input, ensure_ascii=False
        )
        if len(prompt) > 400_000:
            raise OperationError("补充消息及引用过长，请缩短后再发送", "input_too_large", 422)
        self.session.add(
            AmadeusRunInstruction(
                run_id=identity,
                owner_user_id=self.principal.user_id,
                request_id=body.request_id,
                message_id=message_id,
                body_sha256=digest,
                prompt=prompt,
                status="pending",
                sequence=sequence,
                created_at=now,
            )
        )
        await self.session.commit()
        return next(x for x in await self.items(identity) if x.request_id == body.request_id)

    async def claim(self, conversation, identity, dispatch_key, is_ready):
        await self.session.rollback()
        run = await self.run(conversation, identity, write=True)
        if run.status != "running":
            await close_instructions(self.session, [identity])
            await self.session.commit()
            return None
        run.input_ready_at = utc_now() if is_ready else None
        item = (
            await self.session.scalar(
                select(AmadeusRunInstruction)
                .where(
                    AmadeusRunInstruction.run_id == identity,
                    AmadeusRunInstruction.status == "pending",
                )
                .order_by(AmadeusRunInstruction.sequence)
            )
            if is_ready
            else None
        )
        result = None
        if item is not None:
            item.status, item.dispatch_key = "sending", dispatch_key
            await self.session.execute(
                update(AmadeusMessage)
                .where(AmadeusMessage.id == item.message_id)
                .values(status="sending")
            )
            run.last_event_sequence += 1
            item.sequence = run.last_event_sequence
            self.session.add(
                AmadeusRunEvent(
                    run_id=identity,
                    owner_user_id=self.principal.user_id,
                    sequence=item.sequence,
                    kind="user_instruction",
                    payload_json={"message_id": item.message_id, "request_id": item.request_id},
                    idempotency_key=f"instruction:{item.request_id}",
                    created_at=utc_now(),
                )
            )
            result = InstructionClaim(
                request_id=item.request_id, text=item.prompt, text_sha256=checksum(item.prompt)
            )
        await self.session.commit()
        return result

    async def settle(self, conversation, identity, dispatch_key, receipt):
        await self.session.rollback()
        await self.run(conversation, identity, write=True)
        item = await self.existing(identity, receipt.request_id)
        if (
            item is None
            or item.dispatch_key != dispatch_key
            or checksum(item.prompt) != receipt.text_sha256
            or (item.status not in {"sending", "unknown", receipt.status})
        ):
            raise OperationError("插入回执与投递记录不符", "instruction_receipt_conflict", 409)
        item.status = receipt.status
        await self.session.execute(
            update(AmadeusMessage)
            .where(AmadeusMessage.id == item.message_id)
            .values(status=receipt.status)
        )
        await self.session.commit()
