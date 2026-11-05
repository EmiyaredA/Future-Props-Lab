from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, WebSocket

from app.deps import SessionDep, StudioAuth, resolve_studio_websocket_principal
from app.llm.admission import admission_for
from app.llm.http_credentials import socket_credential
from app.llm.realtime import list_realtime_models, run_realtime_model_test
from app.llm.schemas.realtime_voice import RealtimeVoiceOptionsOut
from app.runtime.config import get_settings
from studio.contracts.identity.errors import AccountError

router = APIRouter(tags=["model-test"])


@router.get("/model-test/realtime-options", response_model=RealtimeVoiceOptionsOut)
async def realtime_options(session: SessionDep, _auth: StudioAuth) -> RealtimeVoiceOptionsOut:
    return await list_realtime_models(session)


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin", "").rstrip("/")
    if not origin:
        return False
    allowed = {value.rstrip("/") for value in get_settings().cors_origin_list}
    if origin in allowed:
        return True
    parsed = urlsplit(origin)
    return parsed.scheme in {"http", "https"} and parsed.netloc == websocket.headers.get("host", "")


@router.websocket("/model-test/realtime")
async def realtime_socket(websocket: WebSocket) -> None:
    if not _origin_allowed(websocket):
        await websocket.close(code=4403, reason="origin_not_allowed")
        return
    try:
        principal = await resolve_studio_websocket_principal(websocket)
        owner_user_id = principal.owner_user_id
    except HTTPException as exc:
        await websocket.close(code=4401 if exc.status_code == 401 else 4403)
        return
    try:
        admission = admission_for(websocket)
        lease_id = await admission.acquire(principal, voice=True)
    except AccountError:
        await websocket.close(code=4429, reason="runtime_quota_exceeded")
        return
    except HTTPException:
        await websocket.close(code=1013, reason="model_admission_unavailable")
        return
    current_principal = principal

    async def check_access():
        nonlocal current_principal
        try:
            current = await resolve_studio_websocket_principal(websocket)
            current_principal = current
            if current.owner_user_id != owner_user_id or current.session_id != principal.session_id:
                raise HTTPException(403)
        except HTTPException:
            await websocket.close(code=4403, reason="account_access_changed")
            from starlette.websockets import WebSocketDisconnect

            raise WebSocketDisconnect(4403) from None

    original_send = websocket.send_json

    async def projected_send(event, mode="text"):
        if not current_principal.allows("diagnostics.realtime"):
            event = {
                key: value
                for key, value in event.items()
                if key not in {"timings", "usage", "provider_event", "diagnostics", "raw"}
            }
        await original_send(event, mode=mode)

    websocket.send_json = projected_send
    try:
        await websocket.accept()
        credential = await socket_credential(websocket, principal)
        await run_realtime_model_test(
            websocket,
            session_factory=websocket.app.state.database.sessions,
            owner_user_id=owner_user_id,
            check_access=check_access,
            credential=credential,
        )
    finally:
        await admission.release(lease_id)
