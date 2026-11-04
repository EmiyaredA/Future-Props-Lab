from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.console.cloud_control.access import require_unlocked
from app.console.governance.code_agents import resolve_connection
from app.deps import SessionDep, StudioAuth
from app.runtime.operation_receipts import OperationError

from ..execution import events, storage
from ..execution.schemas import (
    ApprovalDecision,
    ChatCreate,
    ChatDetail,
    ChatOut,
    ExecutionCatalog,
    TurnCreate,
    TurnOut,
)

router = APIRouter()


def local(request):
    return getattr(request.state, "website_local", False)


async def require_agent(agent_id):
    try:
        await resolve_connection(agent_id, probe=False)
    except OperationError as exc:
        raise HTTPException(exc.status, detail={"code": exc.code, "message": str(exc)}) from exc


@router.get("/execution/catalog", response_model=ExecutionCatalog)
async def catalog(request: Request, db: SessionDep, principal: StudioAuth):
    return await storage.catalog(db, principal, local(request))


@router.get("/chats", response_model=list[ChatOut])
async def list_chats(db: SessionDep, principal: StudioAuth):
    return await storage.list_chats(db, principal.user_id)


@router.post("/chats", response_model=ChatOut, status_code=201)
async def create_chat(request: Request, body: ChatCreate, db: SessionDep, principal: StudioAuth):
    await require_unlocked(db, principal, local=local(request))
    await require_agent(body.agent_id)
    return await storage.create_chat(db, principal.user_id, body)


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def detail(chat_id: str, db: SessionDep, principal: StudioAuth):
    return await storage.detail(db, principal.user_id, chat_id)


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
    await require_agent(chat.agent_id)
    turn, created = await storage.create_turn(db, principal.user_id, chat_id, body)
    if created:
        request.app.state.workbench_runs.start(principal, local(request), chat_id, turn.id)
    return turn


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
    await storage.decide(db, principal.user_id, chat_id, turn_id, approval_id, body.approved)


@router.get("/chats/{chat_id}/events", response_class=StreamingResponse)
async def stream(request: Request, chat_id: str, db: SessionDep, principal: StudioAuth):
    await storage.get_chat(db, principal.user_id, chat_id)
    await db.rollback()
    return StreamingResponse(
        events.stream(request, principal, chat_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
