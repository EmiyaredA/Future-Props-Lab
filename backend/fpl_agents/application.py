"""Assemble only the Agent workbench, its storage, collector protocol and lifecycle."""

from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.apps.agent_workbench.change_stream import stream_events
from app.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchProject, WorkbenchTurn
from app.apps.agent_workbench.execution.transcripts import recover_owned_turns
from app.apps.agent_workbench.models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchEntry,
    WorkbenchOperation,
    WorkbenchSession,
    WorkbenchSource,
)
from app.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.config import get_settings
from app.runtime.time import utc_now
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.database import Database
from fpl_runtime.http_dependencies import db_session
from fpl_runtime.migrations import check
from fpl_runtime.native_protocol import COLLECTOR_OPERATIONS
from fpl_runtime.native_queue import NativeQueue
from fpl_runtime.request_limit import RequestLimit

from .authorization import NativeTransport
from .execution_http import router as execution_router
from .migrations.registry import MIGRATIONS
from .models import NativeJob, NativeProjectionReceipt, NativeSubscription, NativeWorkerSeen
from .native_access import NativeSourceAccess
from .native_api import router as native_router
from .routes import router
from .supervisor import CollectionSupervisor

MODELS = (
    WorkbenchProject,
    WorkbenchChat,
    WorkbenchTurn,
    WorkbenchSource,
    WorkbenchSession,
    WorkbenchEntry,
    WorkbenchCheckpoint,
    WorkbenchOperation,
    WorkbenchChange,
    NativeJob,
    NativeSubscription,
    NativeProjectionReceipt,
    NativeWorkerSeen,
)


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    identity,
    native_ingress_token,
    workers,
    version="development",
    collect=True,
    web_root=None,
):
    database = Database(
        "agents",
        state_root,
        models=MODELS,
        account_models=tuple(model for model in MODELS if model is not NativeWorkerSeen),
    )
    if get_settings().database_path != database.path:
        raise ValueError("工作台配置必须指向自己的数据目录")
    supervisor = CollectionSupervisor(database, identity)

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "agents", MIGRATIONS)
        await recover_owned_turns(database.sessions)
        if collect and get_settings().fpl_agent_workbench_enabled:
            await supervisor.start()
        try:
            yield
        finally:
            await supervisor.stop()
            await identity.close()
            await database.close()

    app = FastAPI(
        title="FPL Agents",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "agents"
    app.state.database = database
    app.state.identity = identity
    app.state.native_queue = NativeQueue(
        database,
        NativeJob,
        operations=COLLECTOR_OPERATIONS,
        clock=utc_now,
    )
    app.state.workbench_native = NativeSourceAccess(app.state.native_queue)

    async def reauthorize(request):
        if not await identity.active(
            assertion=request.state.service_assertion,
            method=request.method,
            path=request.url.path,
        ):
            raise HTTPException(401, {"code": "studio_auth_required"})
        return True

    async def authorize_events(request, _principal):
        try:
            return await reauthorize(request)
        except HTTPException:
            return False

    app.state.workbench_reauthorize = reauthorize
    app.state.workbench_event_stream = partial(
        stream_events,
        sessions=database.sessions,
        authorizer=authorize_events,
    )

    async def sessions():
        async with database.sessions() as session:
            yield session

    app.dependency_overrides[db_session] = sessions
    app.include_router(router, prefix="/v1")
    app.include_router(execution_router, prefix="/v1")
    app.include_router(native_router)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    if web_root is not None:
        from fpl_runtime.protocol_hash import public_contract
        from fpl_runtime.web import attach_web, load_release

        release = load_release(web_root, "agents")
        if release.api_sha256 != public_contract(app.openapi(), "agents", catalog):
            raise ValueError("工作台页面与服务契约不匹配")
        attach_web(
            app,
            release,
            pages=(
                "/agents",
                "/agents/",
                "/agents/sources",
                "/agents/sources/",
                "/agents/sessions/{session_id}",
            ),
        )
    app.add_middleware(SignedIdentity, service="agents", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/_native/", maximum=32 * 1024 * 1024)
    app.add_middleware(
        NativeTransport,
        ingress_token=native_ingress_token,
        workers=workers,
        operations=COLLECTOR_OPERATIONS,
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "agents", "version": version}

    @app.get("/ready")
    async def ready():
        if collect and get_settings().fpl_agent_workbench_enabled and not supervisor.is_healthy:
            raise HTTPException(503, "采集任务协调器不可用")
        check(database.path, "agents", MIGRATIONS)
        async with database.sessions(info={"allow_system_reads": True}) as session:
            await session.execute(text("SELECT 1"))
        raise HTTPException(503, "workbench_execution_unavailable")

    expected = {
        (op.method, op.path): op.operation_id for op in catalog.operations if op.service == "agents"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if expected != actual:
        raise ValueError("工作台公共接口与聚合契约不匹配")
    return app
