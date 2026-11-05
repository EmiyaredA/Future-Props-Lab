"""Assemble only the Agent workbench, its storage, collector protocol and lifecycle."""

import asyncio
from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from studio.apps.agent_workbench.authorization import NativeTransport
from studio.apps.agent_workbench.execution.models import (
    WorkbenchChat,
    WorkbenchProject,
    WorkbenchTurn,
)
from studio.apps.agent_workbench.execution.transcripts import (
    latest_turn_version,
    recover_owned_turns,
)
from studio.apps.agent_workbench.execution_discovery import ExecutionDiscovery
from studio.apps.agent_workbench.execution_turns import ExecutionTurns
from studio.apps.agent_workbench.native_access import NativeSourceAccess
from studio.apps.agent_workbench.storage.change_events import SqlChangeEvents
from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.apps.agent_workbench.storage.models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchEntry,
    WorkbenchOperation,
    WorkbenchSession,
    WorkbenchSource,
)
from studio.apps.agent_workbench.storage.service_models import (
    NativeJob,
    NativeProjectionReceipt,
    NativeSubscription,
    NativeWorkerSeen,
    WorkbenchExecutionJob,
)
from studio.apps.agent_workbench.storage.turn_settlement import SqlTurnSettlement
from studio.apps.agent_workbench.storage.turn_versions import SqlTurnVersions
from studio.apps.agent_workbench.supervisor import CollectionSupervisor
from studio.apps.agent_workbench.transport.change_events import stream_events
from studio.apps.agent_workbench.transport.execution_http import router as execution_router
from studio.apps.agent_workbench.transport.execution_native_http import router as execution_native
from studio.apps.agent_workbench.transport.native_api import router as native_router
from studio.apps.agent_workbench.transport.service import create_router
from studio.apps.agent_workbench.transport.turn_events import stream_turns
from studio.apps.agent_workbench.use_cases.settle_turn import SettleTurn
from studio.config.settings import get_settings
from studio.contracts.agent_workbench.native import COLLECTOR_OPERATIONS
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.dependencies import OwnerDep, SessionDep, StudioAuth, db_session
from studio.runtime.http.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.tasks.native_queue import NativeQueue
from studio.runtime.time import utc_now

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
    WorkbenchExecutionJob,
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
    execution_workers=None,
):
    settings = get_settings()
    database = Database(
        "agents",
        state_root,
        models=MODELS,
        account_models=tuple(model for model in MODELS if model is not NativeWorkerSeen),
    )
    if settings.database_path != database.path:
        raise ValueError("工作台配置必须指向自己的数据目录")
    supervisor = CollectionSupervisor(database, identity)
    discovery = ExecutionDiscovery(database, identity, configured=bool(execution_workers))

    turns = ExecutionTurns(
        database, identity, discovery, settlement=SettleTurn(SqlTurnSettlement(database.sessions))
    )

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "agents", MIGRATIONS)
        await recover_owned_turns(database.sessions)
        await discovery.recover()
        if collect and settings.fpl_agent_workbench_enabled:
            await supervisor.start()
        maintenance = asyncio.create_task(turns.maintain())
        _app.state.execution_maintenance = maintenance
        try:
            yield
        finally:
            maintenance.cancel()
            await asyncio.gather(maintenance, return_exceptions=True)
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
    app.state.execution_discovery = discovery
    app.state.workbench_enabled = lambda: settings.fpl_agent_workbench_enabled
    app.state.execution_turns = turns

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

    app.state.workbench_turn_stream = partial(
        stream_turns,
        versions=SqlTurnVersions(
            database.sessions,
            load=latest_turn_version,
            readiness=lambda _owner, _chat, version: any(
                turns.instructions.steerable(turn_id) for turn_id, _ in version[1]
            ),
        ),
        authorizer=authorize_events,
    )
    app.state.workbench_reauthorize = reauthorize
    app.state.workbench_event_stream = partial(
        stream_events,
        changes=SqlChangeEvents(database.sessions),
        authorizer=authorize_events,
    )

    async def sessions():
        async with database.sessions() as session:
            yield session

    app.dependency_overrides[db_session] = sessions
    reading_router = create_router(SessionDep=SessionDep, StudioAuth=StudioAuth, OwnerDep=OwnerDep)
    app.include_router(reading_router, prefix="/v1")
    app.include_router(execution_router, prefix="/v1", dependencies=reading_router.dependencies)
    app.include_router(native_router)
    if execution_workers:
        app.include_router(execution_native)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    if web_root is not None:
        from studio.contracts.gateway.protocol_hash import public_contract
        from studio.runtime.http.web import attach_web, load_release

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
        execution_workers=execution_workers,
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "agents", "version": version}

    @app.get("/ready")
    async def ready():
        if collect and settings.fpl_agent_workbench_enabled and not supervisor.is_healthy:
            raise HTTPException(503, "采集任务协调器不可用")
        check(database.path, "agents", MIGRATIONS)
        async with database.sessions(info={"allow_system_reads": True}) as session:
            await session.execute(text("SELECT 1"))
        maintenance = getattr(app.state, "execution_maintenance", None)
        if not discovery.ready or not turns.ready or maintenance is None or maintenance.done():
            raise HTTPException(503, "workbench_execution_unavailable")
        return {"status": "ready", "service": "agents", "version": version}

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
