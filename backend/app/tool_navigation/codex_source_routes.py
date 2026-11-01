"""Local website adapter for the local Codex configuration tool."""

from fastapi import APIRouter, HTTPException, Request

from app.deps import StudioAuth
from app.runtime.website import require_local_browser
from app.tool_navigation.codex_source import (
    CodexSourceConflict,
    CodexSourceError,
    CodexSourceRestore,
    CodexSourceState,
    CodexSourceUpdate,
    read_codex_source,
    restore_codex_source,
    update_codex_source,
)

router = APIRouter(prefix="/tool-navigation/codex-source", tags=["tool-navigation"])


def _require_local_admin(request: Request, principal: StudioAuth) -> None:
    require_local_browser(request, principal)
    if principal.auth_kind != "session" or not principal.is_platform_admin:
        raise HTTPException(403, detail="仅本机网站平台管理员可管理本机 Codex 配置")


@router.get("", response_model=CodexSourceState)
def get_codex_source(request: Request, principal: StudioAuth) -> CodexSourceState:
    _require_local_admin(request, principal)
    try:
        return read_codex_source()
    except CodexSourceError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.put("", response_model=CodexSourceState)
def put_codex_source(
    request: Request, principal: StudioAuth, body: CodexSourceUpdate
) -> CodexSourceState:
    _require_local_admin(request, principal)
    try:
        return update_codex_source(body)
    except CodexSourceConflict as exc:
        raise HTTPException(409, detail=str(exc)) from exc
    except CodexSourceError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/restore", response_model=CodexSourceState)
def post_codex_source_restore(
    request: Request, principal: StudioAuth, body: CodexSourceRestore
) -> CodexSourceState:
    _require_local_admin(request, principal)
    try:
        return restore_codex_source(body)
    except CodexSourceConflict as exc:
        raise HTTPException(409, detail=str(exc)) from exc
    except CodexSourceError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
