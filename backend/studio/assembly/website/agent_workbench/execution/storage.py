"""Transactions for account-owned CLI conversations, turns and approval receipts."""

import asyncio
import time

from fastapi import HTTPException

from studio.apps.agent_workbench.execution import projects, transcripts, turn_records
from studio.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchTurn
from studio.apps.agent_workbench.execution.schemas import (
    AgentChoice,
    ChatOut,
    ExecutionCatalog,
    InstructionOut,
    ProjectChoice,
)
from studio.apps.agent_workbench.execution.turn_activity import next_activity_sequence
from studio.apps.identity.storage.cloud_access import allowed, require_unlocked
from studio.host.agent_execution.cli.catalog import DEFINITIONS, inspect_connection
from studio.runtime.ids import new_id


async def catalog(db, principal, local, *, load_settings):
    settings = await asyncio.to_thread(load_settings)
    if not allowed(principal, local=local, settings=settings):
        return ExecutionCatalog(enabled=False, projects=[], agents=[])
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


async def checked_project(db, principal, *, load_settings, local, project_id=None, chat_id=None):
    """Snapshot the authorized binding, then release SQLite before touching disk."""
    await db.rollback()
    settings = await asyncio.to_thread(load_settings)
    await require_unlocked(db, principal, local=local, settings=settings)
    owner = principal.user_id
    if chat_id is not None:
        chat = await transcripts.get_chat(db, owner, chat_id)
        project_id, agent_id = chat.project_id, chat.agent_id
    else:
        agent_id = None
    project = await projects.binding(db, project_id, owner, local=local, settings=settings)
    await db.rollback()
    return await projects.check_root(project, settings), agent_id


async def check_binding(db, principal, project, *, load_settings, local, chat_id=None, write=False):
    # Refresh deployment settings before acquiring the write lock. The database
    # session and project binding are then verified in the same transaction.
    settings = await asyncio.to_thread(load_settings)
    if write:
        await turn_records.begin(db)
    await require_unlocked(db, principal, local=local, settings=settings)
    owner = principal.user_id
    identity = project.identity
    if chat_id is not None:
        chat = await transcripts.get_chat(db, owner, chat_id)
        identity = chat.project_id
    current = await projects.binding(db, identity, owner, local=local, settings=settings)
    if not project.matches_binding(current):
        raise HTTPException(409, "项目已变更，请重试")


async def create_chat(db, principal, body, *, load_settings, local):
    owner = principal.user_id
    project, _ = await checked_project(
        db, principal, project_id=body.project_id, local=local, load_settings=load_settings
    )
    await check_binding(
        db, principal, project, local=local, write=True, load_settings=load_settings
    )
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


async def create_turn(db, principal, chat_id, body, *, load_settings, local):
    owner = principal.user_id
    project, _ = await checked_project(
        db, principal, chat_id=chat_id, local=local, load_settings=load_settings
    )
    await check_binding(
        db,
        principal,
        project,
        local=local,
        chat_id=chat_id,
        write=True,
        load_settings=load_settings,
    )
    return await turn_records.store_turn(
        db, owner, chat_id, body, local=local, session_id=principal.session_id
    )


async def change_queue(db, principal, chat_id, *, load_settings, local, remove_id=None):
    owner = principal.user_id
    project, _ = await checked_project(
        db, principal, chat_id=chat_id, local=local, load_settings=load_settings
    )
    await check_binding(
        db,
        principal,
        project,
        local=local,
        chat_id=chat_id,
        write=True,
        load_settings=load_settings,
    )
    chat = await transcripts.get_chat(db, owner, chat_id)
    if remove_id:
        row = await transcripts.get_turn(db, owner, chat_id, remove_id)
        if row.status == "removed":
            await db.rollback()
            return
        if row.status != "queued":
            raise HTTPException(409, "此消息已开始执行")
        row.status = "removed"
        row.queued_session_id = None
        row.revision += 1
    else:
        active = await db.scalar(
            transcripts.chat_turns(owner, chat_id).where(
                WorkbenchTurn.status.in_(transcripts.ACTIVE)
            )
        )
        if active:
            raise HTTPException(409, "请等待当前轮结束后继续队列")
        rows = (await db.scalars(transcripts.queued_turns(owner, chat_id))).all()
        for row in rows:
            row.queued_session_id, row.queued_local = principal.session_id, local
        chat.queue_paused = False
    await db.commit()


async def claim_queue(db, principal, chat_id, turn_id, *, load_settings, local):
    owner = principal.user_id
    project, _ = await checked_project(
        db, principal, chat_id=chat_id, local=local, load_settings=load_settings
    )
    await check_binding(
        db,
        principal,
        project,
        local=local,
        chat_id=chat_id,
        write=True,
        load_settings=load_settings,
    )
    chat = await transcripts.get_chat(db, owner, chat_id)
    head = await db.scalar(transcripts.queued_turns(owner, chat_id).limit(1))
    active = await db.scalar(
        transcripts.chat_turns(owner, chat_id).where(WorkbenchTurn.status.in_(transcripts.ACTIVE))
    )
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
    await turn_records.begin(db)
    head = await db.scalar(transcripts.queued_turns(owner, chat_id).limit(1))
    if head and (head.id, head.queued_session_id, head.queued_local) == (
        head_id,
        session_id,
        local,
    ):
        chat = await transcripts.get_chat(db, owner, chat_id)
        chat.queue_paused = True
        await db.commit()
        return True
    await db.rollback()
    return False


async def decide(db, principal, chat_id, turn_id, approval_id, approved, *, load_settings, local):
    owner = principal.user_id
    project, _ = await checked_project(
        db, principal, chat_id=chat_id, local=local, load_settings=load_settings
    )
    await check_binding(
        db,
        principal,
        project,
        local=local,
        chat_id=chat_id,
        write=True,
        load_settings=load_settings,
    )
    await turn_records.record_decision(db, owner, chat_id, turn_id, approval_id, approved)


async def consume_approval(db, key, identity, principal, project, *, load_settings, local):
    await check_binding(
        db, principal, project, local=local, chat_id=key[1], write=True, load_settings=load_settings
    )
    return await turn_records.reserve_approval(db, key, identity)


async def reserve_instruction(db, principal, key, body, *, load_settings, local, ready):
    project, _ = await checked_project(
        db, principal, chat_id=key[1], local=local, load_settings=load_settings
    )
    await check_binding(
        db, principal, project, local=local, chat_id=key[1], write=True, load_settings=load_settings
    )
    row = await transcripts.get_turn(db, *key)
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
    await turn_records.begin(db)
    row = await transcripts.get_turn(db, *key)
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
