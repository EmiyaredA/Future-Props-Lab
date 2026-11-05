"""Stable gateway APIs; no Portal code, application ORM or application database access."""

import hashlib
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from studio.apps.gateway.notifications import router as notification_router
from studio.apps.gateway.service_status import ServiceMonitor
from studio.apps.gateway.storage.migrations.registry import MIGRATIONS
from studio.apps.gateway.storage.service_models import ChangeCursor, ChangeReceipt
from studio.apps.gateway.transport.service import router
from studio.config.settings import get_settings
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit

MODELS = (ChangeCursor, ChangeReceipt)


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    capabilities,
    schema,
    manifest,
    publishers=None,
    access=None,
    monitor=None,
    version="development",
):
    database = Database("gateway", state_root, models=MODELS)
    service_monitor = monitor if monitor is not None else ServiceMonitor(capabilities)
    if get_settings().database_path != database.path:
        raise ValueError("网关配置必须指向自己的数据目录")
    catalog.check_openapi(
        {
            **schema,
            "paths": {
                path: methods
                for path, methods in schema["paths"].items()
                if path.startswith("/v1/")
            },
        }
    )

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "gateway", MIGRATIONS)
        try:
            yield
        finally:
            await service_monitor.close()
            await capabilities.close()
            await database.close()

    app = FastAPI(
        title="FPL Gateway",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "gateway"
    app.state.database = database
    app.state.capabilities = capabilities
    app.state.public_schema = schema
    app.state.automation_manifest = manifest
    app.state.publishers = dict(publishers or {})
    app.state.access = access
    app.state.service_monitor = service_monitor
    app.include_router(router, prefix="/v1")
    app.include_router(notification_router)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_middleware(SignedIdentity, service="gateway", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/_internal/", maximum=64 * 1024)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "gateway", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "gateway", MIGRATIONS)
        async with database.sessions(info={"allow_system_reads": True}) as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": "gateway"}

    @app.get("/build.json")
    async def build():
        # This identifies only the gateway. Application bundles carry separate versions.
        return {
            "service": "gateway",
            "build_id": version,
            "contract": hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest(),
        }

    expected = {
        (op.method, op.path): op.operation_id
        for op in catalog.operations
        if op.service == "gateway"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if expected != actual:
        raise ValueError("网关公共接口与聚合契约不匹配")
    return app
