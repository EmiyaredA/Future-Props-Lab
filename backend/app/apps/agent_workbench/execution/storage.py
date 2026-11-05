"""Transactions for account-owned CLI conversations, turns and approval receipts."""

import asyncio
import time

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.capabilities.agents.cli.catalog import DEFINITIONS, inspect_connection
from app.console.cloud_control.access import allowed, require_unlocked
from app.runtime.config import get_cloud_settings
from app.runtime.ids import new_id

from . import projects, transcripts
from .models import WorkbenchChat, WorkbenchTurn
from .schemas import AgentChoice, ChatOut, ExecutionCatalog, ProjectChoice, TurnOut
from .transcripts import ACTIVE, end_turn, get_turn
from .transcripts import get_chat as get_chat
from .transcripts import interrupt_all as interrupt_all
from .transcripts import latest_turn_version as latest_turn_version
from .transcripts import recent_turns as recent_turns


async def begin(db):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))


async def catalog(db, principal, local):
    if not allowed(principal, local=local):
        return ExecutionCatalog(enabled=False, projects=[], agents=[])
    settings = await asyncio.to_thread(get_cloud_settings)
    legacy_projects = []
    for identity, project in settings.fpl_cloud_control_projects.items():
        if principal.user_id not in project.user_ids:
            continue
        try:
            binding = await projects.binding(
                db, identity, principal.user_id, local=False, settings=settings
            )
            await projects.check_root(binding, settings)
        except HTTPException:
            continue
        legacy_projects.append(ProjectChoice(id=identity, label=project.label))
    recent_projects = await projects.recent(db, principal.user_id, settings) if local else []
    await db.rollback()
    suggested_directories = await asyncio.to_thread(projects.suggestions, settings) if local else []
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
    return ExecutionCatalog(
        enabled=True,
        projects=legacy_projects,
        agents=agents,
        can_select_directory=local,
        recent_projects=recent_projects,
        suggested_directories=suggested_directories,
    )


async def list_chats(db, owner):
    return await transcripts.list_chats(db, owner, load_labels=projects.labels)


async def detail(db, owner, chat_id):
    return await transcripts.detail(db, owner, chat_id, load_labels=projects.labels)


async def checked_project(db, principal, *, local, project_id=None, chat_id=None):
    """Snapshot the authorized binding, then release SQLite before touching disk."""
    await db.rollback()
    settings = await asyncio.to_thread(get_cloud_settings)
    await require_unlocked(db, principal, local=local, settings=settings)
    owner = principal.user_id
    if chat_id is not None:
        chat = await get_chat(db, owner, chat_id)
        project_id, agent_id = chat.project_id, chat.agent_id
    else:
        agent_id = None
    project = await projects.binding(db, project_id, owner, local=local, settings=settings)
    await db.rollback()
    return await projects.check_root(project, settings), agent_id


async def check_binding(db, principal, project, *, local, chat_id=None, write=False):
    # Refresh deployment settings before acquiring the write lock. The database
    # session and project binding are then verified in the same transaction.
    settings = await asyncio.to_thread(get_cloud_settings)
    if write:
        await begin(db)
    await require_unlocked(db, principal, local=local, settings=settings)
    owner = principal.user_id
    identity = project.identity
    if chat_id is not None:
        chat = await get_chat(db, owner, chat_id)
        identity = chat.project_id
    current = await projects.binding(db, identity, owner, local=local, settings=settings)
    if not project.matches_binding(current):
        raise HTTPException(409, "项目已变更，请重试")


async def create_chat(db, principal, body, *, local):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, project_id=body.project_id, local=local)
    await check_binding(db, principal, project, local=local, write=True)
    if local:
        await projects.touch(db, owner, body.project_id)
    chat = WorkbenchChat(
        id=new_id(),
        owner_user_id=owner,
        project_id=body.project_id,
        agent_id=body.agent_id,
        created_at=int(time.time()),
    )
    db.add(chat)
    await db.commit()
    return ChatOut.model_validate(chat).model_copy(update={"project_label": project.label})


async def create_turn(db, principal, chat_id, body, *, local):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, chat_id=chat_id, local=local)
    await check_binding(db, principal, project, local=local, chat_id=chat_id, write=True)
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


async def decide(db, principal, chat_id, turn_id, approval_id, approved, *, local):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, chat_id=chat_id, local=local)
    await check_binding(db, principal, project, local=local, chat_id=chat_id, write=True)
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


async def consume_approval(db, key, identity, principal, project, *, local):
    await check_binding(db, principal, project, local=local, chat_id=key[1], write=True)
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
