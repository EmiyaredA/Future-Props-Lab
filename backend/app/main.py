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
from app.apps.agent_workbench.sync.runner import WorkbenchSyncRunner
from app.apps.galgame_workshop.assets.annotation_import_runner import GalgameAnnotationImportRunner
from app.apps.galgame_workshop.assets.asr import GalgameAsrRunner
from app.apps.galgame_workshop.video.video_export_runner import GalgameVideoExportRunner
from app.apps.galgame_workshop.video.video_handoff_runner import GalgameVideoEditorHandoffRunner
from app.apps.interview_assistant.runner import InterviewPreparationRunner
from app.apps.motion_compositor.runner import MotionExportRunner
from app.apps.thought_workshop.external_sync.runner import ArticleSyncRunner
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
from app.console.file_library.library_folder_archive import cleanup_library_folder_archive_staging
from app.console.governance.database_auth import (
    authenticate_database_request,
    authenticate_database_websocket,
)
from app.console.governance.external_sync_access import external_sync_actor_allowed
from app.console.governance.generation_queue import claim_visual_capacity, visual_queue_candidates
from app.console.governance.interview_executor_access import interview_actor_allowed
from app.console.governance.model_template_sync import ModelTemplateSyncRunner
from app.console.governance.profile import reconcile_profile_avatars
from app.console.governance.provisioning import create_account
from app.console.governance.runtime_quotas import recover_admissions
from app.console.governance.service import AccountError
from app.console.governance.visual_acceptance_access import acceptance_actor_allowed
from app.llm.catalog.http_bindings import CatalogBindings
from app.llm.catalog.legacy_defaults import LegacyCatalogDefaults
from app.llm.catalog.legacy_usage import LegacyCatalogTaskUsage
from app.llm.inference.runner import InferenceRunner
from app.llm.local_models.catalog import local_root
from app.llm.local_models.installer import Installer
from app.llm.local_models.management import LocalModels
from app.llm.local_models.runtime import LocalRuntime
from app.llm.playground.generation_runner import ModelTestGenerationRunner
from app.llm.playground.recovery import recover_interrupted_model_test_runs
from app.llm.playground.transcription_runner import ModelTestTranscriptionRunner
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
            WorkbenchSyncRunner(),
            InterviewPreparationRunner(interview_actor_allowed),
            ArticleSyncRunner(external_sync_actor_allowed),
            ModelTemplateSyncRunner(),
            VisualGenerationRunner(
                claim_admission=claim_visual_capacity, queue_candidates=visual_queue_candidates
            ),
            AcceptanceRunner(actor_allowed=acceptance_actor_allowed),
            ModelTestGenerationRunner(SessionLocal),
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
app.state.studio_http_auth = authenticate_database_request
app.state.studio_socket_auth = authenticate_database_websocket
app.state.model_catalog_bindings = CatalogBindings(
    defaults=LegacyCatalogDefaults,
    task_usage=LegacyCatalogTaskUsage,
)
app.state.workbench_native = LocalSourceAccess()
app.state.account_creator = create_account
app.state.account_storage_check = upgrade_pending
app.state.code_agent_runs = CodeAgentRuns()
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
