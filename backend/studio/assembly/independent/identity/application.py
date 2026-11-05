"""Account-only ASGI application, with its own SQLite and lifecycle."""

from contextlib import asynccontextmanager
from functools import partial
from urllib.parse import urlsplit

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.cloud_control.models import CloudFactor, CloudUnlock
from app.console.routes import cloud_totp
from studio.apps.identity.account_directory import router as account_directory_router
from studio.apps.identity.accounts import create_account
from studio.apps.identity.authorization import router as authorization_router
from studio.apps.identity.catalog_events import router as catalog_events_router
from studio.apps.identity.cloud_authority import router as cloud_authority_router
from studio.apps.identity.community_assets import router as community_assets_router
from studio.apps.identity.creative_authors import router as creative_authors_router
from studio.apps.identity.creative_source_evidence import router as creative_source_evidence_router
from studio.apps.identity.delegation import router as delegation_router
from studio.apps.identity.integration_intents import IntegrationIntents
from studio.apps.identity.live import router as live_router
from studio.apps.identity.model_audit import ModelAuditInbox
from studio.apps.identity.model_governance import router as model_governance_router
from studio.apps.identity.project_certification import router as certification_router
from studio.apps.identity.retention_api import router as retention_router
from studio.apps.identity.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.storage.models.accounts import (
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    User,
)
from studio.apps.identity.storage.models.registration import (
    RegistrationInviteCode,
    RegistrationRedemption,
)
from studio.apps.identity.storage.service_models import (
    AccountEvent,
    CertificationAuditDelivery,
    IntegrationIntent,
    ModelAuditDelivery,
    ModelAuditIntent,
    VisualGenerationApproval,
)
from studio.apps.identity.transport.database_auth import authenticate_database_request
from studio.apps.identity.transport.identity_gateway import GatewayTransport
from studio.apps.identity.transport.integration_intent_http import (
    router as integration_intent_router,
)
from studio.apps.identity.transport.model_audit_http import router as model_audit_router
from studio.apps.identity.transport.website import account_management, accounts, registration
from studio.config import ConfigurationError
from studio.config.settings import get_cloud_settings, get_settings
from studio.contracts.identity.certification import MAX_BODY as CERTIFICATION_BODY
from studio.contracts.identity.certification import PREFIX as CERTIFICATION_PREFIX
from studio.contracts.identity.errors import AccountError
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.problem_details import (
    account_exception_handler,
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.rate_limit import AttemptLimiter
from studio.runtime.http.request_limit import RequestLimit

MODELS = (
    CloudFactor,
    CloudUnlock,
    User,
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    RegistrationInviteCode,
    RegistrationRedemption,
    AccountEvent,
    ModelAuditDelivery,
    ModelAuditIntent,
    IntegrationIntent,
    CertificationAuditDelivery,
    VisualGenerationApproval,
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
    management_gateway_token=None,
    management_local_origin="http://127.0.0.1:9002",
    management_public_origin="",
):
    settings = get_settings()
    database = Database("identity", state_root, models=MODELS, account_models=())
    if settings.database_path != database.path:
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
    app.state.settings = settings
    app.state.service_id = "identity"
    app.state.database = database
    app.state.auth_attempts = AttemptLimiter()
    app.state.integration_intents = IntegrationIntents(
        database, private_key.public_key(), catalog, private_key=private_key, key_id=key_id
    )
    app.state.model_audit_inbox = ModelAuditInbox(database, private_key.public_key(), catalog)
    app.state.studio_http_auth = partial(
        authenticate_database_request,
        allowed_origins=tuple(settings.cors_origin_list),
    )
    app.state.account_creator = create_account

    async def no_storage_upgrade(_session):
        return False

    app.state.account_storage_check = no_storage_upgrade
    app.state.service_catalog = catalog
    app.state.identity_options = {
        "service_credentials": dict(service_credentials or {}),
        "gateway_token": gateway_token,
        "management_gateway_token": management_gateway_token,
        "management_origins": {
            "local": urlsplit(management_local_origin),
            "public": urlsplit(management_public_origin),
        },
        "private_key": private_key,
        "key_id": key_id,
        "origins": {"local": urlsplit(local_origin), "public": urlsplit(public_origin)},
    }

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
    app.include_router(cloud_totp.router, prefix="/v1/cloud-control", tags=["cloud-control"])
    app.include_router(authorization_router, include_in_schema=False)
    app.include_router(catalog_events_router)
    app.include_router(cloud_authority_router)
    app.include_router(live_router, include_in_schema=False)
    app.include_router(delegation_router, include_in_schema=False)
    app.include_router(creative_source_evidence_router)
    app.include_router(creative_authors_router)
    app.include_router(account_directory_router)
    app.include_router(community_assets_router)
    app.include_router(retention_router)
    app.include_router(model_governance_router)
    app.include_router(model_audit_router)
    app.include_router(certification_router)
    app.add_middleware(RequestLimit, prefix=CERTIFICATION_PREFIX, maximum=CERTIFICATION_BODY)
    app.include_router(integration_intent_router)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(AccountError, account_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_middleware(RequestLimit, prefix="/_internal/v1/creative-authors", maximum=16 * 1024)
    app.add_middleware(
        RequestLimit, prefix="/_internal/v1/cloud-control/authority", maximum=16 * 1024
    )
    app.add_middleware(
        GatewayTransport,
        gateway_token=gateway_token,
        local_origin=local_origin,
        public_origin=public_origin,
        catalog=catalog,
        management_gateway_token=management_gateway_token,
        management_local_origin=management_local_origin,
        management_public_origin=management_public_origin,
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "identity", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "identity", MIGRATIONS)
        try:
            get_cloud_settings()
        except ConfigurationError:
            raise HTTPException(503, "identity_cloud_projection_unavailable") from None
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
