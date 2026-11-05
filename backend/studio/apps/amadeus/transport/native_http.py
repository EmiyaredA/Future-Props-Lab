"""Browser-facing Finder and sandbox capability routes, with private worker ingress."""

import asyncio
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.files import work_root
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.amadeus.amadeus_native import AmadeusPoll, DialogueToolInput, FinderScope
from studio.contracts.amadeus.conversations import RunEventIn
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.dependencies import SessionDep, StudioAuth

public = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])
native = APIRouter(prefix="/_native/v1", include_in_schema=False)


class Leased(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(Leased):
    outcome: NativeOutcome


@public.get("/script-capability")
async def script_capability(request: Request, _principal: StudioAuth) -> dict[str, bool]:
    host = request.app.state.native_host
    return {"available": host is not None and host.sandbox}


@public.post("/conversations/{conversation_id}/files/open-folder")
async def files_open_folder(
    request: Request, session: SessionDep, principal: StudioAuth, conversation_id: str
) -> dict[str, bool]:
    actor = request.state.service_actor
    if not actor.local:
        raise HTTPException(403, "此操作仅支持本机网站入口")
    if actor.auth_kind != "session":
        raise HTTPException(403, "browser_session_required")
    state = request.app.state
    host = state.native_host
    async with state.file_locks.setdefault((principal.user_id, conversation_id), asyncio.Lock()):
        await Conversations(session, principal)._get(conversation_id)
        await session.rollback()
        if host is None or not host.ready:
            raise HTTPException(503, "amadeus_mac_worker_unavailable")
        try:
            identity = UUID(conversation_id)
        except ValueError:
            raise HTTPException(422, "invalid_conversation_id") from None
        if str(identity) != conversation_id:
            raise HTTPException(422, "invalid_conversation_id")
        path = work_root(principal.user_id, conversation_id, files_root=state.database.root)
        await asyncio.to_thread(path.mkdir, mode=0o700, parents=True, exist_ok=True)
        await host.open(
            principal.user_id,
            FinderScope(conversation_id=identity),
            request.state.service_assertion,
        )
    return {"opened": True}


@native.post("/claim")
async def claim(request: Request, body: AmadeusPoll):
    host, worker = request.app.state.native_host, request.state.amadeus_worker
    lease = await host.claim(worker, body)
    if lease is None and body.wait_seconds:
        await asyncio.sleep(body.wait_seconds)
        lease = await host.claim(worker, body)
    return {"lease": lease}


@native.post("/authorize")
async def authorize(request: Request, body: Leased):
    await request.app.state.native_host.authorize(request.state.amadeus_worker, body.lease)
    return {"active": True}


@native.post("/receipt")
async def receipt(request: Request, body: Receipt):
    await request.app.state.native_host.settle(
        request.state.amadeus_worker, body.lease, body.outcome
    )
    return {"acknowledged": True}


class ScriptOutput(Leased):
    text: str = Field(max_length=65_536)


@native.post("/heartbeat")
async def heartbeat(request: Request, body: Leased):
    await request.app.state.native_host.heartbeat(request.state.amadeus_worker, body.lease)
    return {"active": True}


@native.post("/output")
async def output(request: Request, body: ScriptOutput):
    await request.app.state.native_host.output(request.state.amadeus_worker, body.lease, body.text)
    return {"accepted": True}


class DialogueEvent(Leased):
    event: RunEventIn


class DialogueTool(Leased):
    tool: DialogueToolInput


@native.post("/dialogue/plan")
async def dialogue_plan(request: Request, body: Leased):
    turn = await request.app.state.native_host.dialogue_turn(
        request.state.amadeus_worker, body.lease
    )
    return {"prompt": turn.prompt}


@native.post("/dialogue/event")
async def dialogue_event(request: Request, body: DialogueEvent):
    turn = await request.app.state.native_host.dialogue_turn(
        request.state.amadeus_worker, body.lease
    )
    await turn.append(body.event)
    return {"accepted": True}


@native.post("/dialogue/tool")
async def dialogue_tool(request: Request, body: DialogueTool):
    turn = await request.app.state.native_host.dialogue_turn(
        request.state.amadeus_worker, body.lease
    )
    try:
        value = await turn.call(body.tool.name, body.tool.arguments)
    except OperationError as exc:
        return {"ok": False, "code": exc.code, "message": str(exc)}
    return {"ok": True, **value.model_dump(mode="json")}
