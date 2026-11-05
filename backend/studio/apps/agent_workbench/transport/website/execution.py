import asyncio
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.console.governance.code_agents import resolve_connection
from studio.apps.agent_workbench.execution import (
    events,
    history_source,
    projects,
    source_preview,
    storage,
)
from studio.apps.agent_workbench.execution.schemas import (
    ApprovalDecision,
    ChatCreate,
    ChatDetail,
    ChatOut,
    DirectoryListing,
    ExecutionCatalog,
    InstructionCreate,
    InstructionOut,
    ProjectChoice,
    ProjectDirectory,
    SourcePreview,
    TurnCreate,
    TurnOut,
)
from studio.apps.identity.storage.cloud_access import require_enabled, require_unlocked
from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.config.settings import get_cloud_settings
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.website import require_local_browser

router = APIRouter()


@router.get("/sessions/{session_id}/source", response_model=SourcePreview)
async def history_file(
    request: Request,
    response: Response,
    session_id: str,
    db: SessionDep,
    principal: StudioAuth,
    path: Annotated[str, Query(min_length=1, max_length=4096)],
    line: Annotated[int | None, Query(ge=1, le=2147483647)] = None,
):
    response.headers["Cache-Control"] = "no-store"
    return await history_source.read(db, principal, session_id, path, line, local=local(request))


def local(request):
    return getattr(request.state, "website_local", False)


async def require_agent(agent_id):
    try:
        await resolve_connection(agent_id, probe=False)
    except OperationError as exc:
        raise HTTPException(exc.status, detail={"code": exc.code, "message": str(exc)}) from exc


@router.get("/execution/catalog", response_model=ExecutionCatalog)
async def catalog(request: Request, response: Response, db: SessionDep, principal: StudioAuth):
    response.headers["Cache-Control"] = "no-store"
    return await storage.catalog(db, principal, local(request))


@router.get("/execution/directories", response_model=DirectoryListing)
async def directories(
    request: Request,
    response: Response,
    principal: StudioAuth,
    parent: Annotated[str | None, Query(max_length=4096)] = None,
):
    require_local_browser(request, principal)
    require_enabled(principal, local=True)
    response.headers["Cache-Control"] = "no-store"
    return await asyncio.to_thread(projects.browse, parent, get_cloud_settings())


@router.post("/execution/projects", response_model=ProjectChoice)
async def register_project(
    request: Request, body: ProjectDirectory, db: SessionDep, principal: StudioAuth
):
    require_local_browser(request, principal)
    require_enabled(principal, local=True)
    return await projects.register(db, principal.user_id, body.root)


@router.get("/chats", response_model=list[ChatOut])
async def list_chats(db: SessionDep, principal: StudioAuth):
    return await storage.list_chats(db, principal.user_id)


@router.post("/chats", response_model=ChatOut, status_code=201)
async def create_chat(request: Request, body: ChatCreate, db: SessionDep, principal: StudioAuth):
    await require_unlocked(db, principal, local=local(request))
    await require_agent(body.agent_id)
    return await storage.create_chat(db, principal, body, local=local(request))


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def detail(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    return await storage.detail(
        db, principal.user_id, chat_id, request.app.state.workbench_runs.steerable
    )


@router.post("/chats/{chat_id}/turns", response_model=TurnOut, status_code=202)
async def send_turn(
    request: Request,
    chat_id: str,
    body: TurnCreate,
    db: SessionDep,
    principal: StudioAuth,
):
    await require_unlocked(db, principal, local=local(request))
    chat = await storage.get_chat(db, principal.user_id, chat_id)
    if body.mode == "immediate":
        await require_agent(chat.agent_id)
    turn, created = await storage.create_turn(db, principal, chat_id, body, local=local(request))
    runs = request.app.state.workbench_runs
    if turn.status == "queued":
        await runs.advance(principal.user_id, chat_id)
    elif created:
        runs.start(principal, local(request), chat_id, turn.id)
    return turn


@router.delete("/chats/{chat_id}/queue/{turn_id}", status_code=204)
async def remove_queued(
    request: Request, chat_id: str, turn_id: str, db: SessionDep, principal: StudioAuth
):
    await storage.change_queue(db, principal, chat_id, local=local(request), remove_id=turn_id)
    await request.app.state.workbench_runs.advance(principal.user_id, chat_id)


@router.post("/chats/{chat_id}/queue/resume", status_code=204)
async def resume_queue(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    await storage.change_queue(db, principal, chat_id, local=local(request))
    await request.app.state.workbench_runs.advance(principal.user_id, chat_id)


@router.post("/chats/{chat_id}/turns/{turn_id}/instructions", response_model=InstructionOut)
async def insert_instruction(
    request: Request,
    chat_id: str,
    turn_id: str,
    body: InstructionCreate,
    db: SessionDep,
    principal: StudioAuth,
):
    return await request.app.state.workbench_runs.steer(
        db, principal, local(request), chat_id, turn_id, body
    )


@router.get("/chats/{chat_id}/turns/{turn_id}/source", response_model=SourcePreview)
async def preview_source(
    request: Request,
    response: Response,
    chat_id: str,
    turn_id: str,
    call_id: Annotated[str, Query(min_length=1, max_length=255)],
    db: SessionDep,
    principal: StudioAuth,
):
    response.headers["Cache-Control"] = "no-store"
    return await source_preview.read(db, principal, chat_id, turn_id, call_id, local=local(request))


@router.post("/chats/{chat_id}/turns/{turn_id}/stop", status_code=204)
async def stop(request: Request, chat_id: str, turn_id: str, db: SessionDep, principal: StudioAuth):
    await request.app.state.workbench_runs.cancel(db, principal.user_id, chat_id, turn_id)


@router.post("/chats/{chat_id}/turns/{turn_id}/approvals/{approval_id}", status_code=204)
async def decide(
    request: Request,
    chat_id: str,
    turn_id: str,
    approval_id: str,
    body: ApprovalDecision,
    db: SessionDep,
    principal: StudioAuth,
):
    await require_unlocked(db, principal, local=local(request))
    await storage.decide(
        db, principal, chat_id, turn_id, approval_id, body.approved, local=local(request)
    )


@router.get("/chats/{chat_id}/events", response_class=StreamingResponse)
async def stream(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    await storage.get_chat(db, principal.user_id, chat_id)
    await db.rollback()
    return StreamingResponse(
        events.stream(
            request,
            principal,
            chat_id,
            request.app.state.workbench_runs.ready_turn,
            sessions=request.app.state.database.sessions,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
