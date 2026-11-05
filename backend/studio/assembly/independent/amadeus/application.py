"""Amadeus-owned records, lifecycle recovery and verified account requests."""

from contextlib import asynccontextmanager
from weakref import WeakValueDictionary

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.amadeus.models import AmadeusAction, AmadeusRun
from app.console.amadeus.run_records import ACTIVE
from app.console.amadeus.run_recovery import recover_runs
from studio.apps.amadeus.action_execution import ActionExecution
from studio.apps.amadeus.dialogue_runs import DialogueRuns
from studio.apps.amadeus.native_host import AmadeusHost
from studio.apps.amadeus.request_limits import AmadeusNativeRequestLimits, AmadeusRequestLimits
from studio.apps.amadeus.storage.action_records import recover_actions
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.storage.service_models import MODELS
from studio.apps.amadeus.tool_calls import ToolCalls
from studio.apps.amadeus.transport.action_http import router as action_router
from studio.apps.amadeus.transport.dialogue_http import router as dialogue_router
from studio.apps.amadeus.transport.file_http import router as file_router
from studio.apps.amadeus.transport.native_http import native as native_router
from studio.apps.amadeus.transport.native_http import public as host_router
from studio.apps.amadeus.transport.operation_http import published_catalog
from studio.apps.amadeus.transport.operation_http import router as operation_router
from studio.apps.amadeus.transport.record_http import router
from studio.apps.amadeus.transport.skill_http import router as skill_router
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.contracts.gateway.protocol_hash import public_contract
from studio.runtime.database.migrations import check
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.native_ingress import NativeIngress
from studio.runtime.http.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.lifecycle.locking import service_lock
from studio.runtime.revisions import RevisionConflictError


async def recover(database):
    async with database.sessions(info={"allow_system_reads": True}) as db:
        owners = set(
            await db.scalars(
                select(AmadeusRun.owner_user_id).where(AmadeusRun.status.in_(ACTIVE)).distinct()
            )
        )
        owners.update(
            await db.scalars(
                select(AmadeusAction.owner_user_id)
                .where(AmadeusAction.status == "running")
                .distinct()
            )
        )
    for owner in owners:
        async with database.sessions(info={"owner_user_id": owner}) as db:
            await recover_runs(db)
            await recover_actions(db)


def create_app(*, state_root, catalog, public_key, credential, transport=None, native_options=None):
    if not isinstance(credential, str) or len(credential) < 32:
        raise ValueError("Amadeus 需要专属身份凭据")
    capabilities = CapabilityClient(
        service="amadeus", credential=credential, catalog=catalog, transport=transport
    )
    database = Database("amadeus", state_root, models=MODELS, hide_parameters=True)
    if native_options is not None and native_options.identity_credential != credential:
        raise ValueError("Amadeus 原生配置必须使用同一专属 Identity 凭据")
    identity = LiveAuthorization(service="amadeus", credential=credential, transport=transport)
    host = AmadeusHost(database, identity) if native_options is not None else None
    file_locks = WeakValueDictionary()
    tools = ToolCalls(capabilities, credential, transport)
    actions = ActionExecution(database, identity, capabilities, file_locks, tools, host)
    runs = DialogueRuns(database, identity, capabilities, host, actions, file_locks)

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "amadeus", MIGRATIONS)
                await recover(database)
                if host is not None:
                    await host.recover()
                yield
            finally:
                await runs.close()
                await actions.close()
                await tools.close()
                await identity.close()
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Amadeus", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.capabilities = capabilities
    app.state.file_locks = file_locks
    app.state.actions = actions
    app.state.runs = runs
    app.state.native_host = host
    app.include_router(router)
    app.include_router(file_router)
    app.include_router(operation_router)
    app.include_router(skill_router)
    app.include_router(host_router)
    app.include_router(action_router)
    app.include_router(dialogue_router)
    if host is not None:
        app.include_router(native_router)
    app.add_middleware(AmadeusNativeRequestLimits)
    app.add_middleware(NativeIngress, options=native_options, state_key="amadeus_worker")
    app.add_middleware(AmadeusRequestLimits)
    app.add_middleware(SignedIdentity, service="amadeus", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)

    @app.exception_handler(OperationError)
    async def operation_error(request: Request, exc: OperationError):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "amadeus"}

    @app.get("/ready")
    async def ready():
        if host is None or not host.dialogue_ready:
            raise HTTPException(503, "amadeus_cli_worker_unavailable")
        return {"status": "ok", "service": "amadeus"}

    schema = app.openapi()
    actual = {
        (method.upper(), path)
        for path, ops in schema["paths"].items()
        if path.startswith("/v1/")
        for method in ops
    }
    expected = {
        (item.method, item.path) for item in catalog.operations if item.service == "amadeus"
    }
    if actual != expected or public_contract(schema, "amadeus", catalog) != public_contract(
        published_catalog(), "amadeus", catalog
    ):
        raise ValueError("Amadeus 公开接口与安装契约不匹配")
    return app
