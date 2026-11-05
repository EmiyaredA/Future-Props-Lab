"""Transactions for account-owned CLI conversations, turns and approval receipts."""

import asyncio
import time

from fastapi import HTTPException
from sqlalchemy import select, text, update

from app.capabilities.agents.cli.catalog import DEFINITIONS, inspect_connection
from app.console.cloud_control.access import allowed, require_unlocked
from app.runtime.config import get_cloud_settings
from app.runtime.ids import new_id

from . import projects
from .models import WorkbenchChat, WorkbenchTurn
from .schemas import (
    AgentChoice,
    ChatDetail,
    ChatOut,
    ExecutionCatalog,
    InstructionOut,
    ProjectChoice,
    QueuedTurn,
    TurnOut,
)
from .transcripts import end_turn
from .turn_activity import next_activity_sequence
from .turn_records import store_turn

ACTIVE = ("running", "waiting_approval", "cancelling")
MAX_QUEUE = 20


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
    labels = await projects.labels(db, owner, {row.project_id for row in rows})
    return [
        ChatOut.model_validate(row).model_copy(update={"project_label": labels.get(row.project_id)})
        for row in rows
    ]


def chat_turns(owner, chat_id):
    return select(WorkbenchTurn).where(
        WorkbenchTurn.owner_user_id == owner, WorkbenchTurn.chat_id == chat_id
    )


def queued_turns(owner, chat_id):
    return (
        chat_turns(owner, chat_id)
        .where(WorkbenchTurn.status == "queued")
        .order_by(WorkbenchTurn.position)
    )


async def recent_turns(db, owner, chat_id, limit=50) -> list[TurnOut]:
    rows = (
        await db.scalars(
            chat_turns(owner, chat_id)
            .where(WorkbenchTurn.status.not_in(("queued", "removed")))
            .order_by(WorkbenchTurn.position.desc())
            .limit(limit)
        )
    ).all()
    return [TurnOut.model_validate(row) for row in reversed(rows)]


async def latest_turn_version(db, owner, chat_id):
    chat = await get_chat(db, owner, chat_id)
    versions = (
        await db.execute(
            chat_turns(owner, chat_id)
            .with_only_columns(WorkbenchTurn.id, WorkbenchTurn.revision)
            .where(WorkbenchTurn.status != "removed")
            .order_by(WorkbenchTurn.position.desc())
            .limit(50 + MAX_QUEUE)
        )
    ).all()
    return (chat.queue_paused, tuple(tuple(row) for row in versions))


async def detail(db, owner, chat_id, ready=None):
    chat = await get_chat(db, owner, chat_id)
    labels = await projects.labels(db, owner, {chat.project_id})
    turns = await recent_turns(db, owner, chat_id)
    queue = (await db.scalars(queued_turns(owner, chat_id))).all()
    steerable = next(
        (turn.id for turn in turns if turn.status == "running" and ready and ready(turn.id)),
        None,
    )
    return ChatDetail(
        **ChatOut.model_validate(chat)
        .model_copy(update={"project_label": labels.get(chat.project_id)})
        .model_dump(),
        turns=turns,
        queue=[QueuedTurn.model_validate(row) for row in queue],
        queue_paused=bool(queue and chat.queue_paused),
        steerable_turn_id=steerable,
    )


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
    return await store_turn(db, owner, chat_id, body, local=local, session_id=principal.session_id)


async def change_queue(db, principal, chat_id, *, local, remove_id=None):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, chat_id=chat_id, local=local)
    await check_binding(db, principal, project, local=local, chat_id=chat_id, write=True)
    chat = await get_chat(db, owner, chat_id)
    if remove_id:
        row = await get_turn(db, owner, chat_id, remove_id)
        if row.status == "removed":
            await db.rollback()
            return
        if row.status != "queued":
            raise HTTPException(409, "此消息已开始执行")
        row.status = "removed"
        row.queued_session_id = None
        row.revision += 1
    else:
        active = await db.scalar(chat_turns(owner, chat_id).where(WorkbenchTurn.status.in_(ACTIVE)))
        if active:
            raise HTTPException(409, "请等待当前轮结束后继续队列")
        rows = (await db.scalars(queued_turns(owner, chat_id))).all()
        for row in rows:
            row.queued_session_id, row.queued_local = principal.session_id, local
        chat.queue_paused = False
    await db.commit()


async def next_queued(db, owner, chat_id):
    chat = await get_chat(db, owner, chat_id)
    active = await db.scalar(chat_turns(owner, chat_id).where(WorkbenchTurn.status.in_(ACTIVE)))
    if not chat.queue_paused and not active:
        return await db.scalar(queued_turns(owner, chat_id).limit(1))
    return None


async def claim_queue(db, principal, chat_id, turn_id, *, local):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, chat_id=chat_id, local=local)
    await check_binding(db, principal, project, local=local, chat_id=chat_id, write=True)
    chat = await get_chat(db, owner, chat_id)
    head = await db.scalar(queued_turns(owner, chat_id).limit(1))
    active = await db.scalar(chat_turns(owner, chat_id).where(WorkbenchTurn.status.in_(ACTIVE)))
    if (
        chat.queue_paused
        or active
        or not head
        or head.id != turn_id
        or head.queued_session_id != principal.session_id
        or head.queued_local != local
    ):
        await db.rollback()
        return False
    head.status = "running"
    head.started_at = int(time.time())
    head.queued_session_id = None
    head.revision += 1
    await db.commit()
    return True


async def pause_queue(db, owner, chat_id, *, head_id, session_id, local):
    await begin(db)
    head = await db.scalar(queued_turns(owner, chat_id).limit(1))
    if head and (head.id, head.queued_session_id, head.queued_local) == (
        head_id,
        session_id,
        local,
    ):
        chat = await get_chat(db, owner, chat_id)
        chat.queue_paused = True
        await db.commit()
        return True
    await db.rollback()
    return False


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
    row.approvals = [
        *row.approvals,
        {
            **approval,
            "status": "pending",
            "offset": len(row.answer),
            "sequence": next_activity_sequence(row),
        },
    ]
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
    (await get_chat(db, *key[:2])).queue_paused = True
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
        if row.status != "completed":
            (await get_chat(db, *key[:2])).queue_paused = True
        await db.commit()
        return row.status
    await db.rollback()
    return None


async def interrupt_all(db):
    rows = (await db.scalars(select(WorkbenchTurn).where(WorkbenchTurn.status.in_(ACTIVE)))).all()
    for row in rows:
        end_turn(row, "interrupted", "服务已重启，请核对结果后继续")
    await db.execute(
        update(WorkbenchChat)
        .where(
            WorkbenchChat.id.in_(
                select(WorkbenchTurn.chat_id).where(WorkbenchTurn.status == "queued")
            )
        )
        .values(queue_paused=True)
    )
    await db.commit()


async def reserve_instruction(db, principal, key, body, *, local, ready):
    project, _ = await checked_project(db, principal, chat_id=key[1], local=local)
    await check_binding(db, principal, project, local=local, chat_id=key[1], write=True)
    row = await get_turn(db, *key)
    for item in row.instructions:
        if item["request_id"] == body.request_id:
            if item["text"] != body.text:
                raise HTTPException(409, "请求标识已用于其他指令")
            await db.rollback()
            return InstructionOut.model_validate(item), False
    if row.status != "running" or not ready():
        raise HTTPException(409, "当前轮无法接收插入指令")
    if len(row.instructions) >= 16 or any(x["status"] == "sending" for x in row.instructions):
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
    await db.commit()
    return item, True


async def settle_instruction(db, key, identity, status):
    await begin(db)
    row = await get_turn(db, *key)
    item = next(entry for entry in row.instructions if entry["request_id"] == identity)
    if item["status"] in ("sending", "unknown") and item["status"] != status:
        item = {**item, "status": status}
        row.instructions = [
            item if entry["request_id"] == identity else entry for entry in row.instructions
        ]
        row.revision += 1
        await db.commit()
    else:
        await db.rollback()
    return InstructionOut.model_validate(item)
