"""Account-only ASGI application, with its own SQLite and lifecycle."""

from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.capabilities.identity.errors import AccountError
from app.console.models.accounts import AuthSession, ManagementApiKey, SecurityAuditEvent, User
from app.console.models.platform_governance import RegistrationInviteCode, RegistrationRedemption
from app.console.routes import account_management, accounts, registration
from app.deps import db_session
from app.problem_details import (
    account_exception_handler,
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.config import get_settings
from fpl_runtime.database import Database
from fpl_runtime.migrations import check

from .accounts import create_account
from .authorization import router as authorization_router
from .live import router as live_router
from .migrations.registry import MIGRATIONS
from .models import AccountEvent
from .transport import GatewayTransport

MODELS = (
    User,
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    RegistrationInviteCode,
    RegistrationRedemption,
    AccountEvent,
)


def create_app(
    *,
    state_root,
    catalog,
    gateway_token,
    local_origin,
    public_origin,
    private_key,
    key_id="identity-1",
    version="development",
    service_credentials=None,
):
    database = Database("identity", state_root, models=MODELS, account_models=())
    if get_settings().database_path != database.path:
        raise ValueError("Identity 配置必须指向自己的数据目录")

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "identity", MIGRATIONS)
        try:
            yield
        finally:
            await database.close()

    app = FastAPI(
        title="FPL Identity",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "identity"
    app.state.database = database
    app.state.account_creator = create_account

    async def no_storage_upgrade(_session):
        return False

    app.state.account_storage_check = no_storage_upgrade
    app.state.service_catalog = catalog
    app.state.identity_options = {
        "service_credentials": dict(service_credentials or {}),
        "gateway_token": gateway_token,
        "private_key": private_key,
        "key_id": key_id,
        "origins": {"local": urlsplit(local_origin), "public": urlsplit(public_origin)},
    }

    async def sessions():
        async with database.sessions() as session:
            yield session

    app.dependency_overrides[db_session] = sessions
    included = APIRouter()
    for source in (accounts.router, account_management.router, registration.router):
        for route in source.routes:
            if any(
                (op := catalog.match(method, "/v1" + route.path)) is not None
                and op.service == "identity"
                for method in route.methods
            ):
                included.routes.append(route)
    app.include_router(included, prefix="/v1")
    app.include_router(authorization_router)
    app.include_router(live_router)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(AccountError, account_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_middleware(
        GatewayTransport,
        gateway_token=gateway_token,
        local_origin=local_origin,
        public_origin=public_origin,
        catalog=catalog,
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "identity", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "identity", MIGRATIONS)
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": "identity"}

    expected = {
        (op.method, op.path): op.operation_id
        for op in catalog.operations
        if op.service == "identity"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if actual != expected:
        raise ValueError("Identity 公共契约缺失或包含其他服务的操作")
    return app
