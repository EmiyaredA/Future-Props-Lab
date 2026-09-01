from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.accounts.profile import reconcile_profile_avatars
from app.concurrency.polling_runner import RunnerSupervisor
from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.files.layout_migration import reconcile_project_trash, reconcile_snapshot_imports
from app.files.project_snapshots import cleanup_snapshot_staging
from app.files.storage import AssetStorage
from app.galgame_workshop.annotation_import_runner import GalgameAnnotationImportRunner
from app.galgame_workshop.asr import GalgameAsrRunner
from app.galgame_workshop.video_export_runner import GalgameVideoExportRunner
from app.galgame_workshop.video_handoff_runner import GalgameVideoEditorHandoffRunner
from app.llm.catalog.seed import seed_sayflow_text_catalog
from app.llm.playground.generation_runner import ModelTestGenerationRunner
from app.llm.playground.tool_stream import recover_interrupted_model_test_runs
from app.llm.playground.transcription_runner import ModelTestTranscriptionRunner
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.routes import api_router
from app.video_editor.runner import VideoEditorRunner
from app.visual_workshop.assistant import recover_interrupted_visual_assistant_runs
from app.visual_workshop.generation_runner import VisualGenerationRunner
from db.migrations import apply_migrations
from db.migrations.registry import LATEST_MIGRATION_ID

settings = get_settings()


@asynccontextmanager
async def lifespan(lifespan_app: FastAPI) -> AsyncIterator[None]:
    cleanup_snapshot_staging(settings)
    apply_migrations(settings.database_path)
    await reconcile_profile_avatars()
    async with SessionLocal() as session:
        await reconcile_project_trash(session, AssetStorage(settings))
        await reconcile_snapshot_imports(session, AssetStorage(settings))
        await seed_sayflow_text_catalog(session)
    await recover_interrupted_visual_assistant_runs()
    await recover_interrupted_model_test_runs()
    supervisor = RunnerSupervisor(
        (
            VisualGenerationRunner(),
            ModelTestGenerationRunner(),
            ModelTestTranscriptionRunner(),
            GalgameAsrRunner(),
            GalgameAnnotationImportRunner(),
            GalgameVideoExportRunner(),
            GalgameVideoEditorHandoffRunner(),
            VideoEditorRunner(),
        )
    )
    lifespan_app.state.runner_supervisor = supervisor
    try:
        await supervisor.start()
        yield
    finally:
        await supervisor.stop()
        lifespan_app.state.runner_supervisor = None
        await engine.dispose()


app = FastAPI(
    title="Future Props Lab API",
    version="0.1.0",
    description="未来道具研究所模型目录与调用观测 API",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.include_router(api_router)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
app.add_exception_handler(OperationalError, storage_operational_error_handler)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1 FROM schema_migrations LIMIT 1"))
        await session.execute(text("SELECT 1 FROM workspaces WHERE id = 'default'"))
    supervisor = getattr(app.state, "runner_supervisor", None)
    if supervisor is not None and not supervisor.is_healthy:
        raise StarletteHTTPException(status_code=503, detail="background runners are not ready")
    return {"status": "ready", "schema": LATEST_MIGRATION_ID}
