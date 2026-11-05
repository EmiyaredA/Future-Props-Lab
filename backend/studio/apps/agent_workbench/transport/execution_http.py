"""Read account-owned workbench execution transcripts while the native lane is gated."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from studio.apps.agent_workbench import reading
from studio.apps.agent_workbench.execution import transcripts
from studio.apps.agent_workbench.execution.projects import register_verified, registered_labels
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
from studio.apps.agent_workbench.execution.turn_activity import source_reference
from studio.apps.agent_workbench.execution_discovery import (
    recent_roots,
    registered_history_root,
    registered_project_root,
    store_verified_chat,
)
from studio.contracts.agent_workbench.execution import (
    CATALOG,
    CHECK_PROJECT,
    DIRECTORIES,
    PREVIEW_SOURCE,
    REGISTER,
    DirectoryQuery,
    Discovery,
    HistoryFile,
    ProjectCheck,
    ProjectFile,
    ProjectReady,
    RegisterProject,
    history_source_path,
    relative_history_path,
    source_path,
)
from studio.runtime.http.dependencies import SessionDep, StudioAuth

router = APIRouter(
    prefix="/agent-workbench",
    tags=["agent-workbench"],
)


@router.get("/execution/catalog", response_model=ExecutionCatalog)
async def catalog(request: Request, db: SessionDep, principal: StudioAuth):
    host = request.app.state.execution_discovery
    if not host.configured:
        return ExecutionCatalog(enabled=False, projects=[], agents=[])
    token = request.state.service_assertion
    authority = await host.authority(token, CATALOG)
    if not authority.enabled:
        return ExecutionCatalog(enabled=False, projects=[], agents=[])
    local = request.state.service_actor.local
    recent = await recent_roots(db, principal.user_id) if local else []
    await db.rollback()
    return await host.execute(
        principal.user_id, token, CATALOG, Discovery(local=local, recent=recent)
    )


@router.get("/chats", response_model=list[ChatOut])
async def list_chats(db: SessionDep, principal: StudioAuth):
    return await transcripts.list_chats(db, principal.user_id, load_labels=registered_labels)


def unavailable():
    return HTTPException(
        503, {"code": "workbench_execution_unavailable", "message": "项目执行能力尚未就绪"}
    )


async def local_discovery(request, operation, owner, scope):
    if not request.state.service_actor.local:
        raise HTTPException(403, "此操作仅支持本机网站入口")
    host = request.app.state.execution_discovery
    if not host.configured:
        raise unavailable()
    token = request.state.service_assertion
    authority = await host.authority(token, operation)
    if not authority.enabled:
        raise HTTPException(403, "该账号或入口未启用云控操作")
    return await host.execute(owner, token, operation, scope)


@router.get("/execution/directories", response_model=DirectoryListing)
async def directories(
    request: Request,
    principal: StudioAuth,
    parent: Annotated[str | None, Query(max_length=4096)] = None,
):
    return await local_discovery(
        request, DIRECTORIES, principal.user_id, DirectoryQuery(parent=parent)
    )


@router.post("/execution/projects", response_model=ProjectChoice)
async def register_project(
    request: Request, body: ProjectDirectory, db: SessionDep, principal: StudioAuth
):
    result = await local_discovery(
        request, REGISTER, principal.user_id, RegisterProject(root=body.root)
    )
    return await register_verified(db, principal.user_id, result["root"])


@router.post("/chats", response_model=ChatOut, status_code=201)
async def create_chat(request: Request, body: ChatCreate, db: SessionDep, principal: StudioAuth):
    host = request.app.state.execution_discovery
    if not host.configured:
        raise unavailable()
    token, local = request.state.service_assertion, request.state.service_actor.local
    await host.authority(token, CHECK_PROJECT)
    root = await registered_project_root(db, principal.user_id, body.project_id) if local else None
    await db.rollback()
    result = ProjectReady.model_validate(
        await host.execute(
            principal.user_id,
            token,
            CHECK_PROJECT,
            ProjectCheck(
                project_id=body.project_id, agent=body.agent_id, local=local, registered_root=root
            ),
        )
    )
    return await store_verified_chat(
        db,
        principal.user_id,
        body.project_id,
        body.agent_id,
        result.label,
        local=local,
        expected_root=root,
    )


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def detail(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    return await transcripts.detail(
        db,
        principal.user_id,
        chat_id,
        load_labels=registered_labels,
        ready=request.app.state.execution_turns.instructions.steerable,
    )


@router.post("/chats/{chat_id}/turns", response_model=TurnOut, status_code=202)
async def send_turn(
    request: Request, chat_id: str, body: TurnCreate, db: SessionDep, principal: StudioAuth
):
    return await request.app.state.execution_turns.submit(
        db,
        principal.user_id,
        chat_id,
        body,
        request.state.service_assertion,
        local=request.state.service_actor.local,
        session_id=principal.session_id,
    )


@router.delete("/chats/{chat_id}/queue/{turn_id}", status_code=204)
async def remove_queued(
    request: Request, chat_id: str, turn_id: str, db: SessionDep, principal: StudioAuth
):
    await request.app.state.execution_turns.pending.change(
        db,
        principal.user_id,
        chat_id,
        request.state.service_assertion,
        local=request.state.service_actor.local,
        session_id=principal.session_id,
        remove=turn_id,
    )


@router.post("/chats/{chat_id}/queue/resume", status_code=204)
async def resume_queue(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    await request.app.state.execution_turns.pending.change(
        db,
        principal.user_id,
        chat_id,
        request.state.service_assertion,
        local=request.state.service_actor.local,
        session_id=principal.session_id,
    )


@router.post("/chats/{chat_id}/turns/{turn_id}/instructions", response_model=InstructionOut)
async def insert_instruction(
    request: Request,
    chat_id: str,
    turn_id: str,
    body: InstructionCreate,
    db: SessionDep,
    principal: StudioAuth,
):
    return await request.app.state.execution_turns.instructions.submit(
        db,
        principal.user_id,
        chat_id,
        turn_id,
        body,
        request.state.service_assertion,
        local=request.state.service_actor.local,
        session_id=principal.session_id,
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
    owner = principal.user_id
    turn = await transcripts.get_turn(db, owner, chat_id, turn_id)
    path, line, diff = source_reference(turn, call_id)
    chat = await transcripts.get_chat(db, owner, chat_id)
    local = request.state.service_actor.local
    root = await registered_project_root(db, owner, chat.project_id) if local else None
    scope = ProjectFile(
        project_id=chat.project_id,
        agent=chat.agent_id,
        local=local,
        registered_root=root,
        path=path,
    )
    await db.rollback()
    host = request.app.state.execution_discovery
    token, source = request.state.service_assertion, source_path(chat_id, turn_id)
    await host.authority(token, PREVIEW_SOURCE, source)
    result = await host.execute(owner, token, PREVIEW_SOURCE, scope, source=source)
    current = await transcripts.get_chat(db, owner, chat_id)
    latest_root = await registered_project_root(db, owner, current.project_id) if local else None
    latest_turn = await transcripts.get_turn(db, owner, chat_id, turn_id)
    if (current.project_id, current.agent_id, latest_root) != (
        scope.project_id,
        scope.agent,
        root,
    ) or (source_reference(latest_turn, call_id) != (path, line, diff)):
        raise HTTPException(409, "工作台项目已变更")
    return SourcePreview(path=path, text=result["text"], line=line, diff=diff)


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
    owner = principal.user_id
    conversation = await reading.get_conversation(db, owner, session_id)
    root = conversation.cwd
    if not root or len(root) > 4096:
        raise HTTPException(403, "此会话没有可授权的项目目录")
    try:
        path = relative_history_path(root, path)
    except ValueError:
        raise HTTPException(404, "文件不在会话项目内") from None
    local = request.state.service_actor.local
    registered = await registered_history_root(db, owner, root, local=local)
    scope = HistoryFile(root=root, path=path, local=local, registered=registered)
    await db.rollback()
    host = request.app.state.execution_discovery
    token, source = request.state.service_assertion, history_source_path(session_id)
    await host.authority(token, PREVIEW_SOURCE, source)
    result = await host.execute(owner, token, PREVIEW_SOURCE, scope, source=source)
    current = await reading.get_conversation(db, owner, session_id)
    if (
        current.cwd != root
        or await registered_history_root(db, owner, root, local=local) != registered
    ):
        raise HTTPException(409, "会话项目已变更")
    return SourcePreview(path=path, text=result["text"], line=line)


@router.post("/chats/{chat_id}/turns/{turn_id}/stop", status_code=204)
async def stop(request: Request, chat_id: str, turn_id: str, db: SessionDep, principal: StudioAuth):
    await request.app.state.execution_turns.stop(db, principal.user_id, chat_id, turn_id)


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
    await request.app.state.execution_turns.decide(
        db,
        principal.user_id,
        chat_id,
        turn_id,
        approval_id,
        body.approved,
        request.state.service_assertion,
        local=request.state.service_actor.local,
    )


@router.get("/chats/{chat_id}/events", response_class=StreamingResponse)
async def stream(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    await transcripts.get_chat(db, principal.user_id, chat_id)
    await db.rollback()
    return StreamingResponse(
        request.app.state.workbench_turn_stream(request, principal, chat_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
