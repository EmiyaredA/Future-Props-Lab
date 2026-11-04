from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

import app.orm  # noqa: F401 — register tenant listeners
from app.api import api_router
from app.apps.agent_workbench.execution.runner import WorkbenchRuns
from app.apps.agent_workbench.execution.storage import interrupt_all as interrupt_workbench_runs
from app.apps.agent_workbench.sync.runner import WorkbenchSyncRunner
from app.apps.director_desk.agent_session import DirectorEditorSessions
from app.apps.galgame_workshop.assets.annotation_import_runner import GalgameAnnotationImportRunner
from app.apps.galgame_workshop.assets.asr import GalgameAsrRunner
from app.apps.galgame_workshop.video.video_export_runner import GalgameVideoExportRunner
from app.apps.galgame_workshop.video.video_handoff_runner import GalgameVideoEditorHandoffRunner
from app.apps.interview_assistant.executor_status import executor_status
from app.apps.interview_assistant.runner import InterviewPreparationRunner
from app.apps.motion_compositor.runner import MotionExportRunner
from app.apps.thought_workshop.account_directory import DirectoryBindings
from app.apps.thought_workshop.external_sync.runner import ArticleSyncRunner
from app.apps.thought_workshop.legacy_accounts import LegacyAccountDirectory
from app.apps.thought_workshop.legacy_asset_metadata import LegacyAssetMetadata
from app.apps.thought_workshop.legacy_writing import LegacyWritingModels
from app.apps.thought_workshop.writing import WritingBindings
from app.apps.video_editor.runner import VideoEditorRunner
from app.apps.visual_workshop.acceptance.runner import AcceptanceRunner
from app.apps.visual_workshop.assistant import recover_interrupted_visual_assistant_runs
from app.apps.visual_workshop.generation_runner import VisualGenerationRunner
from app.capabilities.agents.sessions.access import LocalSourceAccess
from app.capabilities.asset_store.account_upgrade import upgrade_pending
from app.capabilities.asset_store.layout_migration import (
    reconcile_project_trash,
    reconcile_snapshot_imports,
)
from app.capabilities.asset_store.project_snapshots import cleanup_snapshot_staging
from app.capabilities.asset_store.storage import AssetStorage
from app.console.amadeus.execution import CodeAgentRuns
from app.console.amadeus.runs import recover_interrupted_amadeus_runs
from app.console.cloud_control.desktop import DesktopConnection
from app.console.creative_workshop.legacy_archives import LegacyCreativeArchives
from app.console.creative_workshop.legacy_authors import LegacyCreativeAuthors
from app.console.creative_workshop.legacy_install import LegacyCreativeInstaller
from app.console.creative_workshop.legacy_sources import LegacyCreativeSources
from app.console.file_library.library_folder_archive import cleanup_library_folder_archive_staging
from app.console.governance.code_agent_connections import enable_connection
from app.console.governance.code_agents import catalog as code_agent_catalog
from app.console.governance.database_auth import (
    authenticate_database_request,
    authenticate_database_websocket,
)
from app.console.governance.external_sync_access import external_sync_actor_allowed
from app.console.governance.generation_queue import (
    admit_generation_tasks,
    claim_visual_capacity,
    visual_queue_candidates,
)
from app.console.governance.interview_executor_access import interview_actor_allowed
from app.console.governance.model_template_sync import ModelTemplateSyncRunner
from app.console.governance.profile import reconcile_profile_avatars
from app.console.governance.provisioning import create_account
from app.console.governance.runtime_quotas import acquire, attach, recover_admissions, release
from app.console.governance.service import AccountError
from app.console.governance.visual_acceptance_access import acceptance_actor_allowed
from app.console.governance.workbench_access import workbench_actor_allowed
from app.demo_runtime.runtime import mock_transport, tool_reply
from app.integrations.external.catalog import ExternalConnections
from app.integrations.http_bindings import IntegrationBindings
from app.integrations.mcp import McpCatalog
from app.integrations.skills.catalog import SkillCatalog
from app.integrations.tool_apis import ToolApiCatalog
from app.llm.admission import AdmissionBindings
from app.llm.call_logs.credentials import snapshot_from_principal
from app.llm.catalog.http_bindings import CatalogBindings
from app.llm.catalog.legacy_defaults import LegacyCatalogDefaults
from app.llm.catalog.legacy_usage import LegacyCatalogTaskUsage
from app.llm.inference.runner import InferenceRunner
from app.llm.legacy_library_inputs import LegacyLibraryInputs
from app.llm.legacy_library_outputs import LegacyLibraryOutputs
from app.llm.library_inputs import LibraryInputBindings
from app.llm.library_outputs import LibraryOutputBindings
from app.llm.local_models.catalog import local_root
from app.llm.local_models.installer import Installer
from app.llm.local_models.management import LocalModels
from app.llm.local_models.runtime import LocalRuntime
from app.llm.playground.generation_runner import ModelTestGenerationRunner
from app.llm.playground.legacy_generation_references import LegacyGenerationReferences
from app.llm.playground.recovery import recover_interrupted_model_test_runs
from app.llm.playground.transcription_runner import ModelTestTranscriptionRunner
from app.llm.provider_transports import ProviderTransports
from app.problem_details import (
    account_exception_handler,
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal, engine
from app.runtime.polling_runner import RunnerSupervisor
from app.runtime.revisions import RevisionConflictError
from db.migrations import apply_migrations
from db.migrations.registry import LATEST_MIGRATION_ID

settings = get_settings()


@asynccontextmanager
async def lifespan(lifespan_app: FastAPI) -> AsyncIterator[None]:
    apply_migrations(settings.database_path)
    async with SessionLocal() as session:
        storage_pending = await upgrade_pending(session)
    lifespan_app.state.storage_upgrade_required = storage_pending
    if storage_pending:
        try:
            yield
        finally:
            await engine.dispose()
        return
    cleanup_snapshot_staging(settings)
    cleanup_library_folder_archive_staging(settings)
    await reconcile_profile_avatars()
    async with SessionLocal() as session:
        await reconcile_project_trash(session, AssetStorage(settings))
        await reconcile_snapshot_imports(session, AssetStorage(settings))
    async with SessionLocal() as session:
        await interrupt_workbench_runs(session)
    await recover_admissions()
    await recover_interrupted_visual_assistant_runs()
    await recover_interrupted_model_test_runs(SessionLocal)
    await recover_interrupted_amadeus_runs()
    lifespan_app.state.code_agent_runs = CodeAgentRuns()
    installer = Installer(local_root(settings))
    local_runtime = LocalRuntime(installer)
    local_models = LocalModels(SessionLocal, installer, local_runtime)
    lifespan_app.state.local_models = local_models
    await local_models.recover()
    supervisor = RunnerSupervisor(
        (
            WorkbenchSyncRunner(actor_allowed=workbench_actor_allowed),
            InterviewPreparationRunner(interview_actor_allowed),
            ArticleSyncRunner(external_sync_actor_allowed),
            ModelTemplateSyncRunner(),
            VisualGenerationRunner(
                claim_admission=claim_visual_capacity, queue_candidates=visual_queue_candidates
            ),
            AcceptanceRunner(actor_allowed=acceptance_actor_allowed),
            ModelTestGenerationRunner(
                SessionLocal, legacy_references=app.state.model_generation_legacy_references
            ),
            InferenceRunner(SessionLocal, local_runtime=local_runtime),
            ModelTestTranscriptionRunner(SessionLocal),
            GalgameAsrRunner(),
            GalgameAnnotationImportRunner(),
            GalgameVideoExportRunner(),
            GalgameVideoEditorHandoffRunner(),
            VideoEditorRunner(),
            VideoEditorRunner(lane="media"),
            MotionExportRunner(),
        )
    )
    lifespan_app.state.runner_supervisor = supervisor
    try:
        await supervisor.start()
        yield
    finally:
        await lifespan_app.state.code_agent_runs.close()
        await lifespan_app.state.workbench_runs.close()
        await supervisor.stop()
        await local_models.close()
        lifespan_app.state.runner_supervisor = None
        await engine.dispose()


app = FastAPI(
    title="Future Props Lab API",
    version="0.1.0",
    description="未来道具研究所模型目录与调用观测 API",
    lifespan=lifespan,
)
app.state.database = SimpleNamespace(sessions=SessionLocal)
app.state.director_editor = DirectorEditorSessions(SessionLocal)
app.state.code_agent_catalog = lambda _request, *, can_enable: code_agent_catalog(
    can_enable=can_enable
)
app.state.code_agent_enable = lambda _request, agent_id: enable_connection(agent_id)
app.state.studio_http_auth = authenticate_database_request
app.state.studio_socket_auth = authenticate_database_websocket
app.state.integration_bindings = IntegrationBindings(
    tool_apis=lambda _request, session, owner: ToolApiCatalog(
        session, owner, demo_tools=tool_reply
    ),
    mcp=lambda _request, session, owner: McpCatalog(session, owner),
    skills=lambda _request, session, owner: SkillCatalog(session, owner),
    external=lambda _request, session, owner: ExternalConnections(session, owner),
)
app.state.model_catalog_bindings = CatalogBindings(
    defaults=LegacyCatalogDefaults,
    task_usage=LegacyCatalogTaskUsage,
)
app.state.model_credential_reader = snapshot_from_principal
app.state.model_admission = AdmissionBindings(acquire, release, attach, admit_generation_tasks)
app.state.model_provider_transports = ProviderTransports(resolve=mock_transport)
app.state.model_library_outputs = LibraryOutputBindings(
    for_request=lambda _request, session, owner: LegacyLibraryOutputs(session, settings, owner)
)
app.state.model_generation_legacy_references = LegacyGenerationReferences(get_settings())
app.state.model_library_inputs = LibraryInputBindings(
    for_request=lambda _request, session, owner: LegacyLibraryInputs(session, settings, owner)
)

SessionLocal.configure(
    info={
        **SessionLocal.kw.get("info", {}),
        "thought_asset_metadata_factory": LegacyAssetMetadata,
        "interview_executor_status": executor_status,
        "creative_authors_factory": LegacyCreativeAuthors,
        "creative_archives_factory": LegacyCreativeArchives,
        "creative_sources_factory": LegacyCreativeSources,
        "creative_installer_factory": LegacyCreativeInstaller,
    }
)

app.state.thought_directory = DirectoryBindings(
    for_request=lambda _request, session, _principal: LegacyAccountDirectory(session)
)
app.state.thought_writing = WritingBindings(
    for_request=lambda _request, owner: LegacyWritingModels(SessionLocal, owner)
)
app.state.workbench_native = LocalSourceAccess()
app.state.account_creator = create_account
app.state.account_storage_check = upgrade_pending
app.state.code_agent_runs = CodeAgentRuns()
app.state.cloud_desktop = DesktopConnection()
app.state.workbench_runs = WorkbenchRuns()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.include_router(api_router)

app.add_exception_handler(AccountError, account_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
app.add_exception_handler(OperationalError, storage_operational_error_handler)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    if getattr(app.state, "storage_upgrade_required", False):
        raise StarletteHTTPException(
            status_code=503,
            detail={
                "code": "account_storage_upgrade_required",
                "message": "account storage upgrade requires restart",
            },
        )
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1 FROM schema_migrations LIMIT 1"))
        await session.execute(text("SELECT 1 FROM users LIMIT 1"))
    supervisor = getattr(app.state, "runner_supervisor", None)
    if supervisor is not None and not supervisor.is_healthy:
        raise StarletteHTTPException(status_code=503, detail="background runners are not ready")
    return {"status": "ready", "schema": LATEST_MIGRATION_ID}
