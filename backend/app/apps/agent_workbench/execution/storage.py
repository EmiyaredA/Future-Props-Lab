"""Transactions for account-owned CLI conversations, turns and approval receipts."""

import asyncio

from fastapi import HTTPException

from app.capabilities.agents.cli.catalog import DEFINITIONS, inspect_connection
from app.console.cloud_control.access import allowed, require_unlocked
from app.runtime.config import get_cloud_settings

from . import projects, transcripts
from .schemas import AgentChoice, ExecutionCatalog, ProjectChoice
from .transcripts import get_chat as get_chat
from .transcripts import get_turn as get_turn
from .transcripts import interrupt_all as interrupt_all
from .transcripts import latest_turn_version as latest_turn_version
from .transcripts import recent_turns as recent_turns
from .turn_records import begin, record_decision, reserve_approval, store_turn


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
    return await transcripts.store_chat(
        db, owner, body.project_id, body.agent_id, project.label, local=local
    )


async def create_turn(db, principal, chat_id, body, *, local):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, chat_id=chat_id, local=local)
    await check_binding(db, principal, project, local=local, chat_id=chat_id, write=True)
    return await store_turn(db, owner, chat_id, body)


async def decide(db, principal, chat_id, turn_id, approval_id, approved, *, local):
    owner = principal.user_id
    project, _ = await checked_project(db, principal, chat_id=chat_id, local=local)
    await check_binding(db, principal, project, local=local, chat_id=chat_id, write=True)
    await record_decision(db, owner, chat_id, turn_id, approval_id, approved)


async def consume_approval(db, key, identity, principal, project, *, local):
    await check_binding(db, principal, project, local=local, chat_id=key[1], write=True)
    return await reserve_approval(db, key, identity)
