"""Independent account tool, MCP, Skill and external-connection application."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.capabilities.identity.errors import AccountError
from app.deps import require_studio_auth
from app.integrations.external.catalog import ExternalConnections
from app.integrations.external.contracts import ExternalError
from app.integrations.external.routes import router as external_router
from app.integrations.http_bindings import IntegrationBindings
from app.integrations.mcp import McpCatalog
from app.integrations.mcp.client import OfficialMcpDiscoveryClient
from app.integrations.routes import router
from app.integrations.skills.archive import SkillArchiveStorage
from app.integrations.skills.catalog import SkillCatalog
from app.integrations.tool_apis import ToolApiCatalog
from app.problem_details import (
    account_exception_handler,
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.credentials import SecretCipher
from app.runtime.polling_runner import RunnerSupervisor
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.creative_stdio import PRIVATE_STDIO
from fpl_runtime.database import Database
from fpl_runtime.external_sync import MAX_EXTERNAL_STEP_BYTES
from fpl_runtime.integration_client import IntegrationAuthorizationUnavailable
from fpl_runtime.migrations import check
from fpl_runtime.request_limit import RequestLimit

from .creative_http import CreativeRequestLimit
from .creative_http import router as creative_router
from .creative_installations import CreativeInstallations
from .creative_preview_http import router as creative_preview_router
from .creative_sources_http import router as creative_sources_router
from .creative_stdio_http import router as creative_stdio_router
from .demo_http import router as demo_install_router
from .demo_tools import DemoToolInstallations
from .external_http import router as external_sync_router
from .external_reads import ExternalReads
from .external_steps import ExternalSteps
from .migrations.registry import MIGRATIONS
from .models import MODELS
from .skill_files import reconcile_skill_files
from .validation import ValidationRecovery
from .validation_http import validation_capacity


class PrivateResponses:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def private(message):
            if message["type"] == "http.response.start" and scope["path"].startswith(
                ("/v1/", "/_internal/")
            ):
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, private if scope["type"] == "http" else send)


class OwnedMcpClient:
    def __init__(self, settings, native):
        self.remote, self.native = OfficialMcpDiscoveryClient(settings), native

    async def discover(self, **options):
        if options["transport"] == "stdio":
            if self.native is None:
                raise HTTPException(503, "mcp_native_worker_unavailable")
            return await self.native.discover(**options)
        return await self.remote.discover(**options)

    async def call(self, **options):
        if options["transport"] == "stdio":
            if self.native is None:
                raise HTTPException(503, "mcp_native_worker_unavailable")
            return await self.native.call(**options)
        return await self.remote.call(**options)


def create_app(
    *,
    settings,
    catalog,
    public_key,
    identity,
    intents,
    capacity,
    mcp_client=None,
    native_mcp=None,
    native_ingress=None,
    native_workers=None,
    tool_transport=None,
    feishu_transport=None,
    demo_tools=None,
    creative_authorization=None,
    version="development",
    web_root=None,
    run_tasks=True,
):
    database = Database(
        "integrations",
        settings.runtime_path,
        models=MODELS,
        account_models=tuple(model for model in MODELS if hasattr(model, "owner_user_id")),
    )
    if settings.database_path != database.path:
        raise ValueError("Integrations 配置必须指向自己的数据目录")
    cipher = SecretCipher(settings.fpl_secrets_key)
    if native_mcp is None and native_ingress is not None:
        from .native_mcp import NativeMcpBroker

        native_mcp = NativeMcpBroker(database, intents, cipher=cipher)
    recovery = ValidationRecovery(database, intents, capacity)
    external_steps = ExternalSteps(database, feishu_transport, cipher=cipher)
    supervisor = RunnerSupervisor((recovery,) + ((native_mcp,) if native_mcp is not None else ()))

    @asynccontextmanager
    async def lifespan(_app):
        try:
            check(database.path, "integrations", MIGRATIONS)
            await reconcile_skill_files(database, settings)
            await external_steps.recover()
            if run_tasks:
                await supervisor.start()
            yield
        finally:
            await supervisor.stop()
            if native_mcp is not None:
                await native_mcp.close()
            await capacity.close()
            await intents.close()
            await identity.close()
            await database.close()

    app = FastAPI(
        title="FPL Integrations",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "integrations"
    app.state.database, app.state.settings = database, settings
    app.state.identity, app.state.identity_public_key = identity, public_key
    app.state.integration_intents, app.state.validation_capacity = intents, capacity
    app.state.external_reads = ExternalReads(database, feishu_transport, cipher=cipher)
    app.state.external_steps = external_steps
    app.state.demo_tool_installations = DemoToolInstallations(database)
    app.state.creative_installations = CreativeInstallations(database, settings)
    app.state.creative_authorization = creative_authorization
    app.include_router(creative_preview_router)
    app.include_router(creative_sources_router)
    app.include_router(creative_stdio_router)
    app.state.integration_validation_recovery = recovery
    app.state.supervisor = supervisor

    def demo_for(request):
        async def reply(tool, inputs):
            run = getattr(request.state, "integration_validation", None)
            if run is None:
                raise HTTPException(503, "integration_demo_authorization_required")
            return await capacity.demo_reply(run.id, tool, inputs)

        return demo_tools or reply

    def mcp_for(request):
        run = getattr(request.state, "integration_validation", None)
        native = native_mcp.bound(run) if native_mcp is not None else None
        return mcp_client or OwnedMcpClient(settings, native)

    if native_mcp is not None and native_ingress is not None:
        from .native_http import attach_native

        attach_native(app, native_mcp, ingress_token=native_ingress, workers=native_workers)
    app.state.integration_bindings = IntegrationBindings(
        tool_apis=lambda request, session, owner: ToolApiCatalog(
            session,
            owner,
            transport=tool_transport,
            cipher=cipher,
            demo_tools=demo_for(request),
            execution=getattr(request.state, "integration_validation", None),
        ),
        mcp=lambda request, session, owner: McpCatalog(
            session,
            owner,
            client=mcp_for(request),
            cipher=cipher,
            execution=getattr(request.state, "integration_validation", None),
        ),
        external=lambda _request, session, owner: ExternalConnections(
            session, owner, feishu_transport, cipher=cipher
        ),
        skills=lambda _request, session, owner: SkillCatalog(
            session, owner, storage=SkillArchiveStorage(settings, owner)
        ),
    )
    app.include_router(
        router,
        prefix="/v1",
        dependencies=[Depends(require_studio_auth), Depends(validation_capacity)],
    )
    app.include_router(external_sync_router)
    app.include_router(demo_install_router)
    app.include_router(creative_router)
    app.include_router(external_router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    for error, handler in (
        (HTTPException, http_exception_handler),
        (StarletteHTTPException, http_exception_handler),
        (RequestValidationError, validation_exception_handler),
        (RevisionConflictError, revision_conflict_handler),
        (OperationalError, storage_operational_error_handler),
        (AccountError, account_exception_handler),
    ):
        app.add_exception_handler(error, handler)

    async def unavailable(request, _exc):
        return await http_exception_handler(
            request, HTTPException(503, "integration_authorization_unavailable")
        )

    app.add_exception_handler(IntegrationAuthorizationUnavailable, unavailable)

    async def external_failure(request, exc):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    app.add_exception_handler(ExternalError, external_failure)
    app.add_middleware(
        RequestLimit, prefix="/_internal/v1/external-sync/", maximum=MAX_EXTERNAL_STEP_BYTES
    )
    app.add_middleware(CreativeRequestLimit)
    app.add_middleware(RequestLimit, prefix=PRIVATE_STDIO, maximum=256 * 1024)
    app.add_middleware(RequestLimit, prefix="/_internal/v1/creative-sources/", maximum=40 * 1024)
    expected = {
        (op.method, op.path): op.operation_id
        for op in catalog.operations
        if op.service == "integrations"
    }
    actual = {
        (method.upper(), path): value["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, value in methods.items()
        if path.startswith("/v1/")
    }
    if actual != expected:
        raise ValueError("Integrations 公共接口与聚合契约不匹配")
    if web_root is not None:
        from fpl_runtime.protocol_hash import public_contract
        from fpl_runtime.web import attach_web, load_release

        release = load_release(web_root, "integrations")
        if release.api_sha256 != public_contract(app.openapi(), "integrations", catalog):
            raise ValueError("Integrations 页面与服务契约不匹配")
        attach_web(
            app,
            release,
            pages=tuple(
                path
                for kind in ("", "/tool-apis", "/mcp", "/skills", "/external-connections")
                for path in ("/integrations" + kind, "/integrations" + kind + "/")
            ),
        )
    app.add_middleware(
        SignedIdentity, service="integrations", public_key=public_key, catalog=catalog
    )
    app.add_middleware(
        RequestLimit,
        prefix="/v1/integrations/skills",
        maximum=settings.fpl_skill_archive_max_bytes + 1024 * 1024,
    )

    app.add_middleware(PrivateResponses)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "integrations", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "integrations", MIGRATIONS)
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        if run_tasks and not supervisor.is_healthy:
            raise HTTPException(503, "integration_recovery_unavailable")
        return {"status": "ready", "service": "integrations"}

    return app
