"""Portal owns no account, application ORM or background runner."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import RedirectResponse

from studio.apps.portal.storage.documents import InstalledDocuments
from studio.apps.portal.storage.migrations.registry import MIGRATIONS
from studio.apps.portal.transport.service import router
from studio.apps.portal.use_cases.documents import DeveloperDocuments
from studio.config import REPO_ROOT
from studio.contracts.identity.errors import AccountError
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.problem_details import (
    account_exception_handler,
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    web_root=None,
    version="development",
    documents_root=REPO_ROOT,
):
    database = Database("portal", state_root, models=())

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "portal", MIGRATIONS)
        try:
            yield
        finally:
            await database.close()

    app = FastAPI(
        title="FPL Portal",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "portal"
    app.state.database = database
    app.state.developer_documents = DeveloperDocuments(InstalledDocuments(documents_root))
    app.include_router(router, prefix="/v1")
    app.add_exception_handler(AccountError, account_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    if web_root is not None:
        from studio.contracts.gateway.protocol_hash import public_contract
        from studio.runtime.http.web import attach_web, load_release

        release = load_release(web_root, "portal")
        if release.api_sha256 != public_contract(app.openapi(), "portal", catalog):
            raise ValueError("门户页面与服务契约不匹配")

        @app.api_route("/docs", methods=["GET", "HEAD"], include_in_schema=False)
        @app.api_route("/docs/", methods=["GET", "HEAD"], include_in_schema=False)
        async def document_center():
            return RedirectResponse("/docs.html", headers={"Cache-Control": "no-store"})

        attach_web(
            app,
            release,
            pages=(
                "/",
                "/home",
                "/home/",
                "/apps",
                "/apps/",
                "/cloud-control",
                "/cloud-control/",
                "/amadeus",
                "/amadeus/",
                "/docs.html",
            ),
            resource_aliases={"/docs/{path:path}": "docs/"},
        )
    app.add_middleware(SignedIdentity, service="portal", public_key=public_key, catalog=catalog)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "portal", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "portal", MIGRATIONS)
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": "portal"}

    expected = {
        (op.method, op.path): op.operation_id for op in catalog.operations if op.service == "portal"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if expected != actual:
        raise ValueError("门户公共接口与聚合契约不匹配")
    return app
