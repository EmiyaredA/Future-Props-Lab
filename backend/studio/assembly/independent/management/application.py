"""Management has its own database and no Identity, Models or workshop ORM imports."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from studio.apps.management.contracts import HOST_OPERATIONS
from studio.apps.management.native import NativeTransport
from studio.apps.management.native import router as native_router
from studio.apps.management.storage.migrations.registry import MIGRATIONS
from studio.apps.management.storage.service_models import HostSnapshot, NativeJob
from studio.apps.management.transport.service import router
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.tasks.native_queue import NativeQueue
from studio.runtime.time import utc_now

MODELS = (NativeJob, HostSnapshot)


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    identity,
    native_ingress_token,
    workers,
    version="development",
    web_root=None,
):
    database = Database("management", state_root, models=MODELS, account_models=(NativeJob,))

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "management", MIGRATIONS)
        try:
            yield
        finally:
            await identity.close()
            await database.close()

    app = FastAPI(
        title="FPL Management",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "management"
    app.state.database, app.state.identity, app.state.public_key = database, identity, public_key
    app.state.native_queue = NativeQueue(
        database, NativeJob, operations=HOST_OPERATIONS, clock=utc_now
    )
    app.include_router(router)
    app.include_router(native_router, include_in_schema=False)
    if web_root is not None:
        from studio.contracts.gateway.protocol_hash import public_contract
        from studio.runtime.http.web import attach_web, load_release

        release = load_release(web_root, "management")
        if release.api_sha256 != public_contract(app.openapi(), "management", catalog):
            raise ValueError("管理页面与接口契约不匹配")
        attach_web(app, release, pages=("/", "/management", "/management/{path:path}"))
    app.add_middleware(SignedIdentity, service="management", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/_native/", maximum=256 * 1024)
    app.add_middleware(NativeTransport, ingress_token=native_ingress_token, workers=workers)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "management", "version": version}

    @app.get("/build.json", include_in_schema=False)
    async def build():
        return {"service": "management", "build_id": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "management", MIGRATIONS)
        return {"status": "ready", "service": "management"}

    expected = {
        (op.method, op.path): op.operation_id
        for op in catalog.operations
        if op.service == "management"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if expected != actual:
        raise ValueError("管理服务公共接口与归属清单不匹配")
    return app
