"""Transactions for account-owned CLI conversations, turns and approval receipts."""

import asyncio
import time

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.capabilities.agents.cli.catalog import DEFINITIONS, inspect_connection
from app.console.cloud_control.access import allowed
from app.runtime.config import get_cloud_settings
from app.runtime.ids import new_id

from .models import WorkbenchChat, WorkbenchTurn
from .project_files import project_for
from .schemas import AgentChoice, ChatDetail, ChatOut, ExecutionCatalog, ProjectChoice, TurnOut

ACTIVE = ("running", "waiting_approval", "cancelling")


async def begin(db):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))


async def catalog(db, principal, local):
    if not allowed(principal, local=local):
        return ExecutionCatalog(enabled=False, projects=[], agents=[])
    settings = get_cloud_settings()
    projects = []
    for identity, project in settings.fpl_cloud_control_projects.items():
        if principal.user_id not in project.user_ids:
            continue
        try:
            project_for(identity, principal.user_id)
        except HTTPException:
            continue
        projects.append(ProjectChoice(id=identity, label=project.label))
    await db.rollback()
    connections = await asyncio.gather(
        *(inspect_connection(settings, agent, discover_models=False) for agent in DEFINITIONS)
    )
    agents = [
        AgentChoice(
            id=agent,
            label=definition.name,
            available=item["available"],
            status=item["message"],
        )
        for (agent, definition), item in zip(DEFINITIONS.items(), connections, strict=True)
        if item["enabled"]
    ]
    return ExecutionCatalog(enabled=True, projects=projects, agents=agents)


async def get_chat(db, owner, chat_id):
    chat = await db.scalar(
        select(WorkbenchChat).where(
            WorkbenchChat.id == chat_id, WorkbenchChat.owner_user_id == owner
        )
    )
    if chat is None:
        raise HTTPException(404, "会话不存在")
    return chat


async def list_chats(db, owner):
    rows = (
        await db.scalars(
            select(WorkbenchChat)
            .where(WorkbenchChat.owner_user_id == owner)
            .order_by(WorkbenchChat.created_at.desc(), WorkbenchChat.id.desc())
            .limit(100)
        )
    ).all()
    return [ChatOut.model_validate(row) for row in rows]


async def recent_turns(db, owner, chat_id, limit=50):
    rows = (
        await db.scalars(
            select(WorkbenchTurn)
            .where(WorkbenchTurn.owner_user_id == owner, WorkbenchTurn.chat_id == chat_id)
            .order_by(WorkbenchTurn.position.desc())
            .limit(limit)
        )
    ).all()
    return list(reversed(rows))


async def detail(db, owner, chat_id):
    chat = await get_chat(db, owner, chat_id)
    return ChatDetail(
        **ChatOut.model_validate(chat).model_dump(),
        turns=[TurnOut.model_validate(row) for row in await recent_turns(db, owner, chat_id)],
    )


async def create_chat(db, owner, body):
    project_for(body.project_id, owner)
    chat = WorkbenchChat(
        id=new_id(),
        owner_user_id=owner,
        project_id=body.project_id,
        agent_id=body.agent_id,
        created_at=int(time.time()),
    )
    db.add(chat)
    await db.commit()
    return ChatOut.model_validate(chat)


async def create_turn(db, owner, chat_id, body):
    await begin(db)
    chat = await get_chat(db, owner, chat_id)
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
    project_for(chat.project_id, owner)
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


def change_approval(turn, identity, status):
    turn.approvals = [
        {**approval, "status": status} if approval["id"] == identity else approval
        for approval in turn.approvals
    ]
    turn.revision += 1


async def decide(db, owner, chat_id, turn_id, approval_id, approved):
    await begin(db)
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
