"""Read account-owned workbench execution transcripts while the native lane is gated."""

import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.apps.agent_workbench.execution import transcripts
from app.apps.agent_workbench.execution.projects import registered_labels
from app.apps.agent_workbench.execution.schemas import (
    ApprovalDecision,
    ChatCreate,
    ChatDetail,
    ChatOut,
    DirectoryListing,
    ExecutionCatalog,
    ProjectChoice,
    ProjectDirectory,
    TurnCreate,
    TurnOut,
)
from fpl_runtime.http_dependencies import SessionDep, StudioAuth

from .routes import require_workbench_session

router = APIRouter(
    prefix="/agent-workbench",
    tags=["agent-workbench"],
    dependencies=[Depends(require_workbench_session)],
)


@router.get("/execution/catalog", response_model=ExecutionCatalog)
async def catalog():
    return ExecutionCatalog(enabled=False, projects=[], agents=[])


@router.get("/chats", response_model=list[ChatOut])
async def list_chats(db: SessionDep, principal: StudioAuth):
    return await transcripts.list_chats(db, principal.user_id, load_labels=registered_labels)


def unavailable():
    return HTTPException(
        503, {"code": "workbench_execution_unavailable", "message": "项目执行能力尚未就绪"}
    )


@router.get("/execution/directories", response_model=DirectoryListing)
async def directories(
    parent: Annotated[str | None, Query(max_length=4096)] = None,  # noqa: ARG001
):
    raise unavailable()


@router.post("/execution/projects", response_model=ProjectChoice)
async def register_project(_body: ProjectDirectory):
    raise unavailable()


@router.post("/chats", response_model=ChatOut, status_code=201)
async def create_chat(_body: ChatCreate):
    raise unavailable()


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def detail(chat_id: str, db: SessionDep, principal: StudioAuth):
    return await transcripts.detail(db, principal.user_id, chat_id, load_labels=registered_labels)


@router.post("/chats/{chat_id}/turns", response_model=TurnOut, status_code=202)
async def send_turn(chat_id: str, _body: TurnCreate, db: SessionDep, principal: StudioAuth):
    await transcripts.get_chat(db, principal.user_id, chat_id)
    raise unavailable()


@router.post("/chats/{chat_id}/turns/{turn_id}/stop", status_code=204)
async def stop(chat_id: str, turn_id: str, db: SessionDep, principal: StudioAuth):
    await transcripts.interrupt_turn(db, principal.user_id, chat_id, turn_id)


@router.post("/chats/{chat_id}/turns/{turn_id}/approvals/{approval_id}", status_code=204)
async def decide(
    chat_id: str,
    turn_id: str,
    approval_id: str,
    _body: ApprovalDecision,
    db: SessionDep,
    principal: StudioAuth,
):
    turn = await transcripts.get_turn(db, principal.user_id, chat_id, turn_id)
    if not any(item["id"] == approval_id for item in turn.approvals):
        raise HTTPException(404, "审批不存在")
    raise unavailable()


async def updates(request, owner, chat_id):
    previous = None
    while not await request.is_disconnected():
        try:
            await request.app.state.workbench_reauthorize(request)
        except HTTPException:
            break
        async with request.app.state.database.sessions(info={"owner_user_id": owner}) as db:
            version = await transcripts.latest_turn_version(db, owner, chat_id)
        if version != previous:
            previous = version
            yield f"event: change\ndata: {json.dumps(version)}\n\n"
        else:
            yield ": heartbeat\n\n"
        await asyncio.sleep(0.6)
    yield "event: auth_expired\ndata: {}\n\n"


@router.get("/chats/{chat_id}/events", response_class=StreamingResponse)
async def stream(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    await transcripts.get_chat(db, principal.user_id, chat_id)
    await db.rollback()
    return StreamingResponse(
        updates(request, principal.user_id, chat_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
