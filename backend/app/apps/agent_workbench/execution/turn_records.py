"""Account-scoped turn state and one-shot approval transitions."""

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.runtime.ids import new_id

from .models import WorkbenchTurn
from .schemas import TurnOut
from .transcripts import ACTIVE, end_turn, get_turn


async def begin(db):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))


async def store_turn(db, owner, chat_id, body):
    existing = await db.scalar(
        select(WorkbenchTurn).where(
            WorkbenchTurn.owner_user_id == owner,
            WorkbenchTurn.chat_id == chat_id,
            WorkbenchTurn.client_id == body.request_id,
        )
    )
    if existing:
        if existing.prompt != body.text:
            raise HTTPException(409, "请求标识已用于其他消息")
        result = TurnOut.model_validate(existing)
        await db.rollback()
        return result, False
    active = await db.scalar(
        select(WorkbenchTurn.id).where(
            WorkbenchTurn.owner_user_id == owner,
            WorkbenchTurn.chat_id == chat_id,
            WorkbenchTurn.status.in_(ACTIVE),
        )
    )
    if active:
        raise HTTPException(409, "请等待当前消息完成")
    position = await db.scalar(
        select(func.max(WorkbenchTurn.position)).where(
            WorkbenchTurn.chat_id == chat_id,
            WorkbenchTurn.owner_user_id == owner,
        )
    )
    turn = WorkbenchTurn(
        id=new_id(),
        owner_user_id=owner,
        chat_id=chat_id,
        client_id=body.request_id,
        position=(position or 0) + 1,
        prompt=body.text,
        answer="",
        status="running",
        approvals=[],
        revision=1,
    )
    db.add(turn)
    await db.commit()
    return TurnOut.model_validate(turn), True


def change_approval(turn, identity, status):
    turn.approvals = [
        {**approval, "status": status} if approval["id"] == identity else approval
        for approval in turn.approvals
    ]
    turn.revision += 1


async def record_decision(db, owner, chat_id, turn_id, approval_id, approved):
    turn = await get_turn(db, owner, chat_id, turn_id)
    approval = next((item for item in turn.approvals if item["id"] == approval_id), None)
    if not approval:
        raise HTTPException(404, "审批不存在")
    decision = "approved" if approved else "rejected"
    if approval["status"] == decision:
        await db.rollback()
        return
    if turn.status != "waiting_approval" or approval["status"] != "pending":
        raise HTTPException(409, "审批已处理或失效")
    change_approval(turn, approval_id, decision)
    await db.commit()


async def append_answer(db, key, delta):
    await begin(db)
    row = await get_turn(db, *key)
    if row.status in ("running", "waiting_approval"):
        row.answer = (row.answer + delta)[:100_000]
        row.revision += 1
        await db.commit()


async def propose_approval(db, key, approval):
    await begin(db)
    row = await get_turn(db, *key)
    preview_bytes = len(approval["preview"].encode()) + sum(
        len(item["preview"].encode()) for item in row.approvals
    )
    if row.status != "running" or len(row.approvals) >= 16 or preview_bytes > 128 * 1024:
        raise ValueError("运行无法接受更多审批")
    row.status = "waiting_approval"
    row.revision += 1
    row.approvals = [*row.approvals, {**approval, "status": "pending"}]
    await db.commit()


def approval_status(row, identity):
    return next((item["status"] for item in row.approvals if item["id"] == identity), None)


async def read_approval_status(db, key, identity):
    return approval_status(await get_turn(db, *key), identity)


async def reserve_approval(db, key, identity):
    row = await get_turn(db, *key)
    status = approval_status(row, identity)
    if row.status != "waiting_approval" or status not in ("approved", "rejected"):
        raise ValueError("审批已失效")
    row.status = "running"
    change_approval(row, identity, "executing" if status == "approved" else "rejected")
    await db.commit()
    return status == "approved"


async def settle_approval(db, key, identity, status):
    await begin(db)
    row = await get_turn(db, *key)
    if row.status == "running" and approval_status(row, identity) == "executing":
        change_approval(row, identity, status)
        await db.commit()


async def request_cancellation(db, key, *, running_task):
    await begin(db)
    row = await get_turn(db, *key)
    if row.status not in ACTIVE:
        await db.rollback()
        return False
    if not running_task:
        end_turn(row, "interrupted", "运行已中断，请核对操作结果")
    elif row.status != "cancelling":
        row.status = "cancelling"
        row.revision += 1
    await db.commit()
    return running_task


async def finish_turn(db, key, status, error=None, *, only_cancelling=False):
    await begin(db)
    row = await get_turn(db, *key)
    eligible = ("cancelling",) if only_cancelling else ACTIVE
    if row.status in eligible:
        end_turn(row, "cancelled" if row.status == "cancelling" else status, error)
        await db.commit()
