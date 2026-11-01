"""Private desktop administration; never available through browser ingress or SDK keys."""

import asyncio
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.capabilities.web_access.contracts import (
    AccessAction,
    AccessConfigIn,
    AccessConfigOut,
    AccessStatus,
    ConfigPrepared,
    CredentialImportIn,
    CredentialOut,
    CredentialTicketIn,
    CredentialTicketOut,
    ReceiptIn,
)
from app.capabilities.web_access.credentials import adopt_legacy, import_file
from app.capabilities.web_access.profiles import AccessError
from app.deps import SessionDep, authenticate_studio_request, require_recent_reauthentication

router = APIRouter(prefix="/desktop/web-access", tags=["desktop"])


def runtime(request, *, native=False):
    controller = getattr(request.app.state, "web_access", None)
    if not controller or not getattr(request.state, "desktop_private", False):
        raise HTTPException(404, detail="Not found")
    if native and (
        not getattr(controller, "native_token", "")
        or not secrets.compare_digest(
            request.headers.get("x-fpl-native-web-access", ""), controller.native_token
        )
    ):
        raise HTTPException(404, detail="Not found")
    return controller


async def manager(request, session, *, recent=False):
    controller = runtime(request)
    principal = await authenticate_studio_request(
        request, session, required_scope="studio:private_read"
    )
    if principal.auth_kind != "session" or not principal.is_platform_admin:
        raise HTTPException(403, detail={"code": "platform_admin_required"})
    if recent:
        require_recent_reauthentication(principal)
    return controller


def configure_errors(app):
    async def error(_request, exc):
        from starlette.responses import JSONResponse

        return JSONResponse(
            {"code": "web_access_error", "detail": str(exc)}, status_code=exc.status
        )

    app.add_exception_handler(AccessError, error)


@router.get("", response_model=AccessStatus)
async def status(request: Request, session: SessionDep):
    return (await manager(request, session)).status()


@router.post("/actions", response_model=AccessStatus)
async def action(request: Request, session: SessionDep, body: AccessAction):
    controller = await manager(request, session, recent=body.action == "public_start")
    return await controller.action(body.action)


@router.get("/config", response_model=AccessConfigOut)
async def config(request: Request, session: SessionDep):
    controller = await manager(request, session)
    return await asyncio.to_thread(controller.store.view)


@router.put("/config", response_model=ConfigPrepared)
async def prepare_config(request: Request, session: SessionDep, body: AccessConfigIn):
    controller = await manager(request, session, recent=True)
    async with controller.lock:
        if controller.local.phase not in {"off", "failed"} or controller.public_enabled:
            raise AccessError("请先停止本地 Web 和公网访问")
        return ConfigPrepared(
            apply_receipt=controller.store.prepare(
                body, session_id=request.state.studio_principal.session_id
            )
        )


@router.post("/config/adopt-legacy", response_model=ConfigPrepared)
async def adopt(request: Request, session: SessionDep):
    controller = await manager(request, session, recent=True)
    async with controller.lock:
        if controller.local.phase not in {"off", "failed"} or controller.public_enabled:
            raise AccessError("请先停止访问服务")
        receipt = await asyncio.to_thread(
            adopt_legacy, controller.store, request.state.studio_principal.session_id
        )
        return ConfigPrepared(apply_receipt=receipt)


@router.post("/credentials/tickets", response_model=CredentialTicketOut)
async def credential_ticket(request: Request, session: SessionDep, body: CredentialTicketIn):
    controller = await manager(request, session, recent=True)
    return CredentialTicketOut(
        ticket=controller.store.ticket(
            "credential",
            {"kind": body.kind, "session_id": request.state.studio_principal.session_id},
        )
    )


@router.post("/credentials/import", response_model=CredentialOut)
async def import_credential(request: Request, session: SessionDep, body: CredentialImportIn):
    controller = runtime(request, native=True)
    await manager(request, session, recent=True)
    grant = controller.store.claim(body.ticket, "credential")
    if grant["session_id"] != request.state.studio_principal.session_id:
        raise AccessError("授权会话已经改变，请重新开始", 403)
    return await asyncio.to_thread(import_file, controller.store, Path(body.path), grant["kind"])


@router.post("/config/claim")
async def claim_config(request: Request, session: SessionDep, body: ReceiptIn):
    controller = runtime(request, native=True)
    await manager(request, session, recent=True)
    async with controller.lock:
        if controller.local.phase not in {"off", "failed"} or controller.public_enabled:
            raise AccessError("请先停止本地 Web")
        grant = controller.store.claim(body.receipt, "config")
        if grant.pop("session_id", None) != request.state.studio_principal.session_id:
            raise AccessError("授权会话已经改变，请重新开始", 403)
        return grant
