"""Own Models HTTP, catalogue provisioning, execution authorization and task lifecycle."""

from contextlib import asynccontextmanager
from functools import partial

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.capabilities.asset_store.errors import AssetError
from studio.apps.model_service.account_events import CatalogProvisioningRunner
from studio.apps.model_service.admission.admission import ModelAdmission, settle
from studio.apps.model_service.admission.execution_authority import ModelTaskAuthority
from studio.apps.model_service.admission.request_admission import request_admission
from studio.apps.model_service.admission.task_usage import OwnedCatalogTaskUsage
from studio.apps.model_service.annotation_transcription import (
    router as annotation_transcription_router,
)
from studio.apps.model_service.assistant_model_runs import AssistantModelExpiry, AssistantModelRuns
from studio.apps.model_service.audit.audit_delivery import ModelAuditDelivery
from studio.apps.model_service.catalog.http_bindings import CatalogBindings
from studio.apps.model_service.defaults import OwnedCatalogDefaults
from studio.apps.model_service.demo import DemoConfiguration, DemoServices
from studio.apps.model_service.demo_installations import DemoInstallations
from studio.apps.model_service.demonstration.execution import DemoRuntime
from studio.apps.model_service.galgame_transcription import (
    GalgameTranscription,
    recover_transcription_attempts,
)
from studio.apps.model_service.governance import router as governance_router
from studio.apps.model_service.inference.runner import InferenceRunner
from studio.apps.model_service.library.inputs import LibraryInputBindings
from studio.apps.model_service.library.outputs import LibraryOutputBindings
from studio.apps.model_service.library_inputs import HttpLibraryInputs
from studio.apps.model_service.library_outputs import HttpLibraryOutputs
from studio.apps.model_service.playground.generation_assets import ROLE_FIELDS
from studio.apps.model_service.playground.generation_runner import ModelTestGenerationRunner
from studio.apps.model_service.playground.recovery import recover_interrupted_model_test_runs
from studio.apps.model_service.playground.transcription_runner import ModelTestTranscriptionRunner
from studio.apps.model_service.provisioning import CatalogProvisioning
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.model_test import (
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
)
from studio.apps.model_service.storage.native_models import NativeModelBroker
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.apps.model_service.stream_access import access_check
from studio.apps.model_service.template_sync import TemplateSynchronization
from studio.apps.model_service.templates.policy import initialize_account_catalog
from studio.apps.model_service.transport.assistant_model_http import (
    router as assistant_model_router,
)
from studio.apps.model_service.transport.demo_http import call_router
from studio.apps.model_service.transport.demo_http import router as demo_router
from studio.apps.model_service.transport.galgame_asr_http import router as galgame_asr_router
from studio.apps.model_service.transport.galgame_transcription_http import (
    router as galgame_transcription_router,
)
from studio.apps.model_service.transport.integration_capacity_http import (
    router as integration_capacity_router,
)
from studio.apps.model_service.transport.native_api import attach_native
from studio.apps.model_service.transport.provider_bindings import ProviderTransports
from studio.apps.model_service.transport.socket_auth import socket_authenticator
from studio.apps.model_service.transport.stream_access import ModelStreamAccess
from studio.apps.model_service.transport.visual_catalog_http import router as visual_catalog_router
from studio.apps.model_service.transport.visual_generation_http import (
    router as visual_generation_router,
)
from studio.apps.model_service.transport.visual_review_http import router as visual_review_router
from studio.apps.model_service.transport.website.local_models import router as local_router
from studio.apps.model_service.transport.website.model_capacity import ModelCapacity
from studio.apps.model_service.transport.website.model_inference import router as inference_router
from studio.apps.model_service.transport.website.models import (
    call_logs,
    diagnostics,
    model_test,
    model_test_generation,
    model_test_realtime,
    model_test_transcription,
    suppliers,
)
from studio.apps.model_service.transport.website.models.catalog import router as catalog_router
from studio.apps.model_service.visual.visual_generation_intake import VisualGenerationIntake
from studio.apps.model_service.visual.visual_generation_results import VisualGenerationResults
from studio.apps.model_service.visual.visual_generation_runner import VisualGenerationRunner
from studio.apps.model_service.visual.visual_review_attempts import VisualReviewAttempts
from studio.apps.model_service.writing import router as writing_router
from studio.assembly.http_dependencies import require_studio_auth
from studio.contracts.identity.errors import AccountError
from studio.contracts.visual_workshop.visual_assistant import MODEL_RUNS as ASSISTANT_MODEL_RUNS
from studio.contracts.visual_workshop.visual_assistant_model import (
    MAX_ROUND_BYTES,
    MAX_SETTLEMENT_BYTES,
    SETTLEMENT_DOMAIN,
    SETTLEMENTS,
)
from studio.contracts.visual_workshop.visual_generation import MAX_PLAN_BYTES, PEER_DOMAIN, PLANS
from studio.contracts.visual_workshop.visual_generation import MODEL as VISUAL_GENERATION_MODEL
from studio.contracts.visual_workshop.visual_review import MAX_MODEL_REQUEST, MODEL_RUN
from studio.contracts.visual_workshop.visual_snapshot import MAX_LAYOUT_BYTES, MODEL_RESOLVE
from studio.contracts.visual_workshop.visual_snapshot import (
    MAX_QUERY_BYTES as MAX_VISUAL_SNAPSHOT_QUERY_BYTES,
)
from studio.contracts.visual_workshop.visual_snapshot import MODELS as VISUAL_SNAPSHOT_MODELS
from studio.runtime.database.migrations import check
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.problem_details import (
    account_exception_handler,
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.messaging.timed_peer import TimedPeer
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.tasks.polling import RunnerSupervisor


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


async def require_private_references(sessions):
    # Legacy references must be converted through the old site's formal backfill
    # before export. An independent worker never guesses an Assets storage path.
    async with sessions(info={"allow_system_reads": True}) as session:
        tasks = list(await session.scalars(select(ModelTestGenerationTask)))
        private = set(
            (
                await session.execute(
                    select(
                        ModelTestGenerationAsset.owner_user_id,
                        ModelTestGenerationAsset.task_id,
                        ModelTestGenerationAsset.id,
                    )
                )
            ).all()
        )
        for task in tasks:
            payload = task.request_payload or {}
            for field, _role, _kind in ROLE_FIELDS:
                value = payload.get(field)
                identities = ([value] if value else []) if field.endswith("_id") else (value or [])
                if any(
                    (task.owner_user_id, task.id, str(identity)) not in private
                    for identity in identities
                ):
                    raise ValueError("生成任务仍有未转移的历史参考素材")


def create_app(
    *,
    settings,
    catalog,
    public_key,
    identity,
    capabilities,
    events,
    directory,
    audit,
    integration_intents=None,
    demo_install_client=None,
    native_models=None,
    local_runtime=None,
    native_ingress_token=None,
    workers=None,
    version="development",
    web_root=None,
    run_tasks=True,
    visual_generation_key=None,
    visual_assistant_settlement_key=None,
):
    database = Database(
        "models", settings.runtime_path, models=MODELS, account_models=ACCOUNT_MODELS
    )
    if settings.database_path != database.path:
        raise ValueError("Models 配置必须指向自己的数据目录")
    ledger = ModelAdmission(database.sessions)
    assistant_runs = AssistantModelRuns(database.sessions)
    authority = ModelTaskAuthority(
        database.sessions, public_key=public_key, catalog=catalog, identity=identity
    )
    broker = NativeModelBroker(database, settings, identity, public_key, catalog)
    configuration = DemoConfiguration(database.sessions)
    demo = DemoRuntime(configuration.configuration)
    synchronization = TemplateSynchronization(database.sessions, directory)
    provisioning = CatalogProvisioning(database.sessions, initializer=initialize_account_catalog)
    provisioning_runner = CatalogProvisioningRunner(client=events, provisioning=provisioning)
    provisioning_runner.poll_interval_seconds = 1
    generation = ModelTestGenerationRunner(
        database.sessions,
        settings,
        prepare_claim=partial(authority.prepare, "model"),
        terminal_settlement=settle,
    )
    inference = InferenceRunner(
        database.sessions,
        local_runtime=local_runtime or broker,
        synthesis_scope=broker.foreground_synthesis,
        settings=settings,
        prepare_claim=partial(authority.prepare, "inference"),
        terminal_settlement=settle,
    )
    transcription = ModelTestTranscriptionRunner(
        database.sessions,
        settings,
        prepare_claim=partial(authority.prepare, "transcription"),
        terminal_settlement=settle,
    )
    audit_runner = ModelAuditDelivery(database.sessions, audit)
    demo_installations = (
        DemoInstallations(database, integration_intents, demo_install_client)
        if demo_install_client is not None
        else None
    )
    if demo_installations is not None and integration_intents is None:
        raise ValueError("演示安装协调缺少Identity固定意图端口")
    broker.connect_inference(inference)
    supervisor = RunnerSupervisor(
        (AssistantModelExpiry(assistant_runs),)
        + (
            provisioning_runner,
            synchronization,
            generation,
            inference,
            transcription,
            broker,
            audit_runner,
        )
        + ((demo_installations,) if demo_installations is not None else ())
    )
    local = native_models or broker

    galgame_asr_staging = settings.runtime_path / ".galgame-asr-work"

    @asynccontextmanager
    async def lifespan(_app):
        try:
            check(database.path, "models", MIGRATIONS)
            await require_private_references(database.sessions)
            await ledger.recover()
            await app.state.visual_review_attempts.recover()
            await assistant_runs.recover()
            await recover_interrupted_model_test_runs(database.sessions)
            await recover_transcription_attempts(database.sessions)
            if galgame_asr_staging.is_symlink() or not galgame_asr_staging.resolve().is_relative_to(
                settings.runtime_path.resolve()
            ):
                raise ValueError("Models 语音识别暂存目录不可用")
            galgame_asr_staging.mkdir(parents=True, exist_ok=True, mode=0o700)
            if run_tasks:
                await supervisor.start()
            yield
        finally:
            await supervisor.stop()
            if not run_tasks:
                await generation.stop()
            await local.close()
            for client in (events, directory, identity, capabilities, audit):
                await client.close()
            if demo_install_client is not None:
                await demo_install_client.close()
            if integration_intents is not None:
                await integration_intents.close()
            await database.close()

    app = FastAPI(
        title="FPL Models",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.demo_installations = demo_installations
    app.state.galgame_transcription = GalgameTranscription(database.sessions)
    app.state.galgame_asr_staging = galgame_asr_staging
    app.state.integration_intents = integration_intents
    app.state.service_id = "models"
    app.state.settings, app.state.database = settings, database
    app.state.identity_public_key, app.state.identity = public_key, identity
    app.state.capabilities = capabilities
    app.state.visual_generation_peer = (
        TimedPeer(visual_generation_key, domain=PEER_DOMAIN)
        if visual_generation_key is not None
        else None
    )
    app.state.visual_generation_intake = VisualGenerationIntake(app.state)
    app.state.visual_generation_runner = VisualGenerationRunner(app.state)
    app.state.visual_generation_results = VisualGenerationResults(app.state)
    app.state.visual_review_attempts = VisualReviewAttempts(app.state)
    if (
        visual_assistant_settlement_key is not None
        and visual_assistant_settlement_key == visual_generation_key
    ):
        raise ValueError("Visual 对话结算凭据必须独立")
    app.state.assistant_settlement_peer = (
        TimedPeer(visual_assistant_settlement_key, domain=SETTLEMENT_DOMAIN)
        if visual_assistant_settlement_key is not None
        else None
    )
    app.state.assistant_model_runs = assistant_runs
    if visual_generation_key is not None:
        supervisor = RunnerSupervisor((*supervisor.runners, app.state.visual_generation_runner))

    app.state.model_catalog_bindings = CatalogBindings(
        defaults=OwnedCatalogDefaults, task_usage=OwnedCatalogTaskUsage
    )
    app.state.model_provider_transports = ProviderTransports(resolve=demo.mock_transport)
    app.state.model_stream_access = ModelStreamAccess(for_request=partial(access_check, identity))
    app.state.demo_configuration, app.state.demo_runtime = configuration, demo
    app.state.demo_services = DemoServices(configuration, demo)
    app.state.model_audit_client = audit
    app.state.template_sync = synchronization
    app.state.runner_supervisor = supervisor
    app.state.local_models = local
    app.state.native_model_retention = broker.retention
    app.state.studio_socket_auth = socket_authenticator(public_key, identity)
    app.state.model_library_inputs = LibraryInputBindings(
        for_request=lambda request, _session, _owner: HttpLibraryInputs(
            capabilities,
            assertion=request.state.service_assertion,
            method=request.method,
            path=request.url.path,
            max_bytes=settings.fpl_visual_asset_max_bytes,
        )
    )
    app.state.model_library_outputs = LibraryOutputBindings(
        for_request=lambda request, _session, _owner: HttpLibraryOutputs(
            capabilities,
            assertion=request.state.service_assertion,
            method=request.method,
            path=request.url.path,
            max_bytes=settings.fpl_visual_asset_max_bytes,
        )
    )

    async def reject_foreign_tasks(*_args, **_kwargs):
        raise ValueError("不能通过模型请求为其他服务的任务申请执行权")

    app.state.model_admission = request_admission(
        ledger, authority, admit_tasks=reject_foreign_tasks
    )
    for source in (
        call_logs.router,
        diagnostics.router,
        model_test.router,
        model_test_generation.router,
        model_test_transcription.router,
        suppliers.router,
        inference_router,
    ):
        app.include_router(
            source, prefix="/v1", dependencies=[Depends(require_studio_auth), ModelCapacity]
        )
    app.include_router(
        catalog_router, prefix="/v1", dependencies=[Depends(require_studio_auth), ModelCapacity]
    )
    app.include_router(local_router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    for source in (model_test_realtime.router, demo_router, call_router, governance_router):
        app.include_router(source, prefix="/v1")
    app.include_router(integration_capacity_router)
    app.include_router(writing_router)
    app.include_router(annotation_transcription_router)
    app.include_router(visual_catalog_router)
    app.include_router(visual_generation_router)
    app.include_router(visual_review_router)
    app.include_router(assistant_model_router)
    app.add_middleware(RequestLimit, prefix=ASSISTANT_MODEL_RUNS, maximum=MAX_ROUND_BYTES)
    app.add_middleware(RequestLimit, prefix=SETTLEMENTS, maximum=MAX_SETTLEMENT_BYTES)
    app.add_middleware(RequestLimit, prefix=MODEL_RUN, maximum=MAX_MODEL_REQUEST)
    app.add_middleware(RequestLimit, prefix=VISUAL_GENERATION_MODEL, maximum=16 * 1024)
    app.add_middleware(RequestLimit, prefix=PLANS, maximum=MAX_PLAN_BYTES)
    app.add_middleware(
        RequestLimit, prefix=VISUAL_SNAPSHOT_MODELS, maximum=MAX_VISUAL_SNAPSHOT_QUERY_BYTES
    )
    app.add_middleware(RequestLimit, prefix=MODEL_RESOLVE, maximum=MAX_LAYOUT_BYTES)
    app.include_router(galgame_asr_router)
    app.include_router(galgame_transcription_router)
    if (native_ingress_token is None) != (workers is None):
        raise ValueError("Models 原生通道需要同时配置入口和worker凭据")
    if native_ingress_token is not None:
        attach_native(app, broker, ingress_token=native_ingress_token, workers=workers)
    else:
        app.state.native_models = broker
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_exception_handler(AccountError, account_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)

    async def asset_failure(request, exc):
        return await http_exception_handler(
            request,
            HTTPException(exc.status, {"code": exc.code, "message": str(exc), **exc.detail}),
        )

    app.add_exception_handler(AssetError, asset_failure)

    async def operation_failure(request, exc):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    app.add_exception_handler(OperationError, operation_failure)
    if web_root is not None:
        from studio.contracts.gateway.protocol_hash import public_contract
        from studio.runtime.http.web import attach_web, load_release

        release = load_release(web_root, "models")
        if release.api_sha256 != public_contract(app.openapi(), "models", catalog):
            raise ValueError("模型页面与服务契约不匹配")
        attach_web(
            app,
            release,
            pages=(
                "/model-service",
                "/model-service/",
                "/model-test",
                "/model-test/",
                "/model-call-logs",
                "/model-call-logs/",
            ),
        )
    app.add_middleware(SignedIdentity, service="models", public_key=public_key, catalog=catalog)
    app.add_middleware(PrivateResponses)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "models", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "models", MIGRATIONS)
        if run_tasks and not supervisor.is_healthy:
            raise HTTPException(503, {"code": "models_runner_unavailable"})
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": "models"}

    expected = {
        (op.method, op.path): op.operation_id for op in catalog.operations if op.service == "models"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if actual != expected:
        raise ValueError(
            "Models 公共接口与聚合契约不匹配："
            f"缺少{len(expected.keys() - actual.keys())}，"
            f"多余{len(actual.keys() - expected.keys())}，"
            f"标识{sum(actual.get(k) != v for k, v in expected.items())}"
        )
    return app
