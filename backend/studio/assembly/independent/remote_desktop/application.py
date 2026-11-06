"""Serve only Remote-owned desktop traffic and preferences."""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.remote_desktop.setup_host import SetupHost
from studio.apps.remote_desktop.storage.migrations.registry import MIGRATIONS
from studio.apps.remote_desktop.storage.preference_models import DesktopPreference
from studio.apps.remote_desktop.storage.preferences import PreferenceRecords
from studio.apps.remote_desktop.storage.service_models import RemoteSetupJob
from studio.apps.remote_desktop.transport.desktop_http import router
from studio.apps.remote_desktop.transport.guacamole import DesktopConnection
from studio.apps.remote_desktop.transport.setup_native_http import router as setup_native_router
from studio.apps.remote_desktop.use_cases.preferences import DesktopPreferences
from studio.config import ConfigurationError
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.identity.cloud_authority import DESKTOP_SOCKET
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.native_ingress import NativeIngress
from studio.runtime.http.problem_details import (
    http_exception_handler,
    problem,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.rate_limit import AttemptLimiter
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.lifecycle.locking import service_lock


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
    setup_options=None,
    cloud_projection=None,
):
    if (setup_options is None) != (cloud_projection is None) or (
        setup_options is not None and setup_options.identity_credential != credential
    ):
        raise ValueError("Remote 设置通道与归属配置未匹配")
    database = Database("remote", state_root, models=(DesktopPreference, RemoteSetupJob))
    preferences = DesktopPreferences(PreferenceRecords(database.sessions))
    identity = LiveAuthorization(service="remote", credential=credential, transport=transport)

    async def current_access(principal, _local, assertion):
        current = await identity.cloud_authority(
            assertion=assertion, method="GET", path=DESKTOP_SOCKET
        )
        if current is None or not current.desktop_authorized:
            return None
        return (await preferences.read(owner=principal.user_id)).idle_minutes

    async def dial(options):
        return await asyncio.open_connection(
            options.guacd_host, options.fpl_cloud_control_guacd_port
        )

    attempts = AttemptLimiter()
    connector = connect_upstream or dial
    desktop = DesktopConnection(
        settings=lambda: settings,
        access=current_access,
        connect_upstream=connector,
        attempts=attempts,
    )

    async def guacd_ready():
        try:
            async with asyncio.timeout(0.75):
                _reader, writer = await connector(settings)
                writer.close()
                await writer.wait_closed()
        except (OSError, TimeoutError):
            return False
        return True

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
    app.state.desktop_preferences = preferences
    app.state.auth_attempts = attempts
    app.state.cloud_desktop = desktop
    app.state.remote_settings = settings
    app.state.cloud_projection = cloud_projection
    app.state.guacd_ready = guacd_ready
    app.state.cloud_setup = SetupHost(database, identity) if setup_options else None
    app.include_router(setup_native_router)
    app.add_middleware(NativeIngress, options=setup_options, state_key="remote_worker")
    app.add_middleware(RequestLimit, prefix="/_native/", maximum=32 * 1024)
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
        if app.state.cloud_setup is None or not app.state.cloud_setup.ready:
            raise HTTPException(503, "remote_setup_worker_unavailable")
        try:
            cloud_projection.read()
        except ConfigurationError:
            raise HTTPException(503, "remote_cloud_projection_unavailable") from None
        if not await guacd_ready():
            raise HTTPException(503, "remote_guacamole_unavailable")
        async with database.sessions() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ready", "service": "remote"}

    return app
