"""One-shot live instructions for the exact running Mac lease."""

import asyncio
from time import monotonic

from fastapi import HTTPException

from app.apps.agent_workbench.execution import transcripts, turn_records
from app.apps.agent_workbench.execution.schemas import InstructionOut
from app.apps.agent_workbench.execution.turn_activity import next_activity_sequence
from fpl_runtime.native_queue import digest
from fpl_runtime.workbench_execution import RUN_TURN, TurnScope, instruction_path


def find_instruction(row, identity):
    return next((item for item in row.instructions if item["request_id"] == identity), None)


def update_instruction(row, item, **fields):
    updated = {**item, **fields}
    row.instructions = [
        updated if entry["request_id"] == item["request_id"] else entry
        for entry in row.instructions
    ]
    row.revision += 1
    return updated


class ExecutionInstructions:
    def __init__(self, turns):
        self.turns = turns
        self.ready_until = {}
        self.grants = {}

    def steerable(self, turn):
        return self.ready_until.get(turn, 0) > monotonic()

    def close_turn(self, owner, turn):
        self.ready_until.pop(turn, None)
        for key in tuple(self.grants):
            if key[:2] == (owner, turn):
                del self.grants[key]

    async def submit(self, db, owner, chat, turn, body, assertion, *, local, session_id):
        await transcripts.get_turn(db, owner, chat, turn)
        await db.rollback()
        grant = await self.turns.issue_grant(
            assertion, instruction_path(chat, turn), local, session_id
        )
        await turn_records.begin(db)
        row = await transcripts.get_turn(db, owner, chat, turn)
        existing = find_instruction(row, body.request_id)
        if existing:
            if existing["text"] != body.text:
                raise HTTPException(409, "请求标识已用于其他指令")
            return InstructionOut.model_validate(existing)
        current = self.turns.grants.get((owner, turn))
        if (
            row.status != "running"
            or current is None
            or current.local != local
            or current.factor_epoch != grant.factor_epoch
            or not self.steerable(turn)
        ):
            raise HTTPException(409, "当前轮无法接收插入指令")
        if len(row.instructions) >= 16 or any(
            item["status"] == "sending" for item in row.instructions
        ):
            raise HTTPException(409, "请等待正在发送的指令，或将新消息加入队列")
        item = InstructionOut(
            request_id=body.request_id,
            text=body.text,
            status="sending",
            offset=len(row.answer),
            sequence=next_activity_sequence(row),
        )
        row.instructions = [*row.instructions, item.model_dump()]
        row.revision += 1
        key = owner, turn, body.request_id
        self.grants[key] = grant
        await db.commit()
        try:
            return await self.wait(db, owner, chat, turn, body.request_id)
        finally:
            self.grants.pop(key, None)

    async def wait(self, db, owner, chat, turn, identity):
        deadline = monotonic() + 10
        while monotonic() < deadline:
            row = await transcripts.get_turn(db, owner, chat, turn)
            item = find_instruction(row, identity)
            if item["status"] != "sending":
                return InstructionOut.model_validate(item)
            await db.rollback()
            await asyncio.sleep(0.15)
        await turn_records.begin(db)
        row = await transcripts.get_turn(db, owner, chat, turn)
        item = find_instruction(row, identity)
        if item["status"] == "sending":
            item = update_instruction(row, item, status="unknown")
            await db.commit()
        return InstructionOut.model_validate(item)

    async def claim(self, worker, lease):
        scope = await self.turns.live(worker, lease)
        owner = lease.owner_user_id
        async with self.turns.session(owner) as db:
            row = await self.turns.owned_turn(db, owner, scope)
            if row.status != "running":
                self.ready_until.pop(scope.turn_id, None)
                return None
            self.ready_until[scope.turn_id] = monotonic() + 2
            item = next((entry for entry in row.instructions if entry["status"] == "sending"), None)
            if item is None or item.get("dispatch_sha256"):
                return None
            identity = item["request_id"]
            key = owner, scope.turn_id, identity
            grant = self.grants.get(key)
            await db.rollback()
            if grant is None:
                return None
            try:
                await self.turns.verify_grant(grant)
            except HTTPException:
                return None
            await turn_records.begin(db)
            row = await self.turns.owned_turn(db, owner, scope)
            item = find_instruction(row, identity)
            if (
                row.status != "running"
                or item is None
                or item["status"] != "sending"
                or item.get("dispatch_sha256")
                or self.grants.get(key) != grant
            ):
                return None
            checksum = digest(item["text"])
            update_instruction(row, item, dispatch_sha256=checksum)
            await db.commit()
            return {"request_id": identity, "text": item["text"], "text_sha256": checksum}

    async def settle(self, worker, body):
        lease = body.lease
        if lease.operation != RUN_TURN:
            raise HTTPException(403, "workbench_execution_operation_forbidden")
        await self.turns.discovery.lease(worker, lease, active=False)
        scope = TurnScope.model_validate(lease.payload)
        owner = lease.owner_user_id
        async with self.turns.session(owner) as db:
            await turn_records.begin(db)
            row = await transcripts.get_turn(db, owner, scope.chat_id, scope.turn_id)
            item = find_instruction(row, body.request_id)
            if not item or item.get("dispatch_sha256") != body.text_sha256:
                raise HTTPException(409, "workbench_instruction_receipt_conflict")
            if item["status"] == body.status:
                return
            if item["status"] not in {"sending", "unknown"}:
                raise HTTPException(409, "workbench_instruction_receipt_conflict")
            update_instruction(row, item, status=body.status)
            await db.commit()
