"""Account-scoped workbench transcript reads and interrupted turn recovery."""

import time

from fastapi import HTTPException
from sqlalchemy import select, text

from app.runtime.ids import new_id

from . import projects
from .models import WorkbenchChat, WorkbenchTurn
from .schemas import ChatDetail, ChatOut, TurnOut

ACTIVE = ("running", "waiting_approval", "cancelling")


async def get_chat(db, owner, chat_id):
    chat = await db.scalar(
        select(WorkbenchChat).where(
            WorkbenchChat.id == chat_id, WorkbenchChat.owner_user_id == owner
        )
    )
    if chat is None:
        raise HTTPException(404, "会话不存在")
    return chat


async def list_chats(db, owner, *, load_labels=None):
    rows = (
        await db.scalars(
            select(WorkbenchChat)
            .where(WorkbenchChat.owner_user_id == owner)
            .order_by(WorkbenchChat.created_at.desc(), WorkbenchChat.id.desc())
            .limit(100)
        )
    ).all()
    labels = await load_labels(db, owner, {row.project_id for row in rows}) if load_labels else {}
    return [
        ChatOut.model_validate(row).model_copy(update={"project_label": labels.get(row.project_id)})
        for row in rows
    ]


async def recent_turns(db, owner, chat_id, limit=50):
    rows = (
        await db.scalars(
            select(WorkbenchTurn)
            .where(WorkbenchTurn.owner_user_id == owner, WorkbenchTurn.chat_id == chat_id)
            .order_by(WorkbenchTurn.position.desc())
            .limit(limit)
        )
    ).all()
    return [TurnOut.model_validate(row) for row in reversed(rows)]


async def latest_turn_version(db, owner, chat_id):
    row = (
        await db.execute(
            select(WorkbenchTurn.id, WorkbenchTurn.revision)
            .where(WorkbenchTurn.owner_user_id == owner, WorkbenchTurn.chat_id == chat_id)
            .order_by(WorkbenchTurn.position.desc())
            .limit(1)
        )
    ).one_or_none()
    return (row.id, row.revision) if row else ()


async def detail(db, owner, chat_id, *, load_labels=None):
    chat = await get_chat(db, owner, chat_id)
    labels = await load_labels(db, owner, {chat.project_id}) if load_labels else {}
    return ChatDetail(
        **ChatOut.model_validate(chat)
        .model_copy(update={"project_label": labels.get(chat.project_id)})
        .model_dump(),
        turns=await recent_turns(db, owner, chat_id),
    )


async def get_turn(db, owner, chat_id, turn_id):
    row = await db.scalar(
        select(WorkbenchTurn).where(
            WorkbenchTurn.id == turn_id,
            WorkbenchTurn.chat_id == chat_id,
            WorkbenchTurn.owner_user_id == owner,
        )
    )
    if row is None:
        raise HTTPException(404, "轮次不存在")
    return row


def end_turn(turn, status, error=None):
    turn.status, turn.error = status, error
    turn.approvals = [
        {
            **approval,
            "status": (
                "unknown"
                if approval["status"] == "executing"
                else "expired"
                if approval["status"] in {"pending", "approved"}
                else approval["status"]
            ),
        }
        for approval in turn.approvals
    ]
    turn.revision += 1


async def interrupt_all(db):
    rows = (await db.scalars(select(WorkbenchTurn).where(WorkbenchTurn.status.in_(ACTIVE)))).all()
    for row in rows:
        end_turn(row, "interrupted", "服务已重启，请核对结果后继续")
    await db.commit()


async def interrupt_turn(db, owner, chat_id, turn_id):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    row = await get_turn(db, owner, chat_id, turn_id)
    if row.status in ACTIVE:
        end_turn(row, "interrupted", "运行已中断，请核对操作结果")
        await db.commit()
    else:
        await db.rollback()


async def recover_owned_turns(sessions):
    async with sessions(info={"allow_system_reads": True}) as session:
        owners = list(
            await session.scalars(
                select(WorkbenchTurn.owner_user_id)
                .where(WorkbenchTurn.status.in_(ACTIVE))
                .distinct()
            )
        )
    for owner in owners:
        async with sessions(info={"owner_user_id": owner}) as session:
            await interrupt_all(session)


async def store_chat(db, owner, project_id, agent_id, project_label, *, local):
    if local:
        await projects.touch(db, owner, project_id)
    chat = WorkbenchChat(
        id=new_id(),
        owner_user_id=owner,
        project_id=project_id,
        agent_id=agent_id,
        created_at=int(time.time()),
    )
    db.add(chat)
    await db.commit()
    return ChatOut.model_validate(chat).model_copy(update={"project_label": project_label})
