"""Serve only Remote-owned desktop traffic and preferences."""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.cloud_control import preferences
from app.console.cloud_control.desktop_bridge import DesktopConnection
from app.console.cloud_control.preference_models import DesktopPreference
from app.problem_details import (
    http_exception_handler,
    problem,
    storage_operational_error_handler,
    validation_exception_handler,
)
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.cloud_authority import DESKTOP_SOCKET
from fpl_runtime.database import Database
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.request_limit import RequestLimit

from .desktop_http import router
from .migrations.registry import MIGRATIONS


def create_app(
    *,
    state_root,
    settings,
    public_key,
    credential,
    catalog,
    schema_path=None,
    transport=None,
    connect_upstream=None,
):
    database = Database("remote", state_root, models=(DesktopPreference,))
    identity = LiveAuthorization(service="remote", credential=credential, transport=transport)

    async def current_access(principal, _local, assertion, epoch):
        current = await identity.cloud_authority(
            assertion=assertion, method="GET", path=DESKTOP_SOCKET
        )
        if current is None or not current.desktop_authorized or current.factor_epoch != epoch:
            return None
        async with database.sessions(info={"owner_user_id": principal.user_id}) as db:
            minutes, _revision = await preferences.desktop_preferences(db, principal.user_id)
            return minutes

    async def dial(options):
        return await asyncio.open_connection(
            options.guacd_host, options.fpl_cloud_control_guacd_port
        )

    desktop = DesktopConnection(
        settings=lambda: settings, access=current_access, connect_upstream=connect_upstream or dial
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "remote", MIGRATIONS)
                yield
            finally:
                for digest in list(desktop.tickets):
                    desktop.discard(digest)
                await identity.close()
                await database.close()

    app = FastAPI(
        title="FPL Remote", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.cloud_desktop = desktop
    app.state.remote_settings = settings
    app.state.cloud_identity = identity
    app.state.identity_public_key = public_key
    app.include_router(router, prefix="/v1")
    app.add_middleware(SignedIdentity, service="remote", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/v1/cloud-control/", maximum=64 * 1024)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, error):
        if request.url.path == "/v1/cloud-control/desktop/connect":
            return problem(request, 422, "桌面登录请求格式无效", code="validation_error")
        return await validation_exception_handler(request, error)

    if schema_path is not None:
        expected = public_contract(json.loads(schema_path.read_text()), "remote", catalog)
        if public_contract(app.openapi(), "remote", catalog) != expected:
            raise ValueError("Remote HTTP 契约不匹配")

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "remote"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "remote_cutover_incomplete")

    return app
