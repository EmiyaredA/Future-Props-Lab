from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, WebSocket

from app.core.config import get_settings
from app.deps import SessionDep, StudioAuth, resolve_studio_websocket_principal
from app.llm.realtime import list_realtime_models, run_realtime_model_test
from app.schemas.realtime_voice import RealtimeVoiceOptionsOut

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
        workspace_id = principal.workspace_id
    except HTTPException as exc:
        await websocket.close(code=4401 if exc.status_code == 401 else 4403)
        return
    await websocket.accept()
    await run_realtime_model_test(websocket, workspace_id=workspace_id)
