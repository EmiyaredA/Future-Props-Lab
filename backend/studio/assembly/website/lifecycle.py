from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db.migrations import apply_migrations
from studio.apps.agent_workbench.execution.runner import WorkbenchRuns
from studio.apps.agent_workbench.execution.transcripts import recover_owned_turns
from studio.apps.agent_workbench.sync.runner import WorkbenchSyncRunner
from studio.apps.amadeus.execution.website_dialogue import CodeAgentRuns
from studio.apps.amadeus.execution.website_runs import recover_interrupted_amadeus_runs
from studio.apps.asset_library.archives.folder_archive import cleanup_library_folder_archive_staging
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.layout.account_upgrade import upgrade_pending
from studio.apps.asset_library.storage.layout.website_upgrade import (
    reconcile_project_trash,
    reconcile_snapshot_imports,
)
from studio.apps.galgame_workshop.assets.annotation_import_runner import (
    GalgameAnnotationImportRunner,
)
from studio.apps.galgame_workshop.assets.asr import GalgameAsrRunner
from studio.apps.galgame_workshop.video.video_export_runner import GalgameVideoExportRunner
from studio.apps.galgame_workshop.video.video_handoff_runner import GalgameVideoEditorHandoffRunner
from studio.apps.identity.profile import reconcile_profile_avatars
from studio.apps.identity.website_access.external_sync import external_sync_actor_allowed
from studio.apps.identity.website_access.interview import interview_actor_allowed
from studio.apps.identity.website_access.visual_acceptance import acceptance_actor_allowed
from studio.apps.identity.website_access.workbench import workbench_actor_allowed
from studio.apps.interview_assistant.runner import InterviewPreparationRunner
from studio.apps.model_service.admission.website_queue import (
    claim_visual_capacity,
    visual_queue_candidates,
)
from studio.apps.model_service.admission.website_quotas import recover_admissions
from studio.apps.model_service.inference.runner import InferenceRunner
from studio.apps.model_service.local_models.catalog import local_root
from studio.apps.model_service.local_models.management import LocalModels
from studio.apps.model_service.playground.generation_runner import ModelTestGenerationRunner
from studio.apps.model_service.playground.recovery import recover_interrupted_model_test_runs
from studio.apps.model_service.playground.transcription_runner import ModelTestTranscriptionRunner
from studio.apps.model_service.templates.website_sync import ModelTemplateSyncRunner
from studio.apps.motion_compositor.runner import MotionExportRunner
from studio.apps.thought_workshop.external_sync.runner import ArticleSyncRunner
from studio.apps.video_editor.runner import VideoEditorRunner
from studio.apps.visual_workshop.acceptance.runner import AcceptanceRunner
from studio.apps.visual_workshop.assistant.actions import recover_interrupted_visual_assistant_runs
from studio.apps.visual_workshop.website.generation_runner import VisualGenerationRunner
from studio.host.local_models.installer import Installer
from studio.host.local_models.runtime import LocalRuntime
from studio.runtime.files.project_archives import cleanup_snapshot_staging
from studio.runtime.tasks.polling import RunnerSupervisor


@asynccontextmanager
async def lifespan(lifespan_app: FastAPI) -> AsyncIterator[None]:
    settings = lifespan_app.state.settings
    database = lifespan_app.state.database
    sessions = database.sessions
    apply_migrations(settings.database_path)
    async with sessions() as session:
        storage_pending = await upgrade_pending(session)
    lifespan_app.state.storage_upgrade_required = storage_pending
    if storage_pending:
        try:
            yield
        finally:
            await database.close()
        return
    cleanup_snapshot_staging(settings)
    cleanup_library_folder_archive_staging(settings)
    await reconcile_profile_avatars(settings)
    async with sessions() as session:
        await reconcile_project_trash(session, AssetStorage(settings))
        await reconcile_snapshot_imports(session, AssetStorage(settings))
    await recover_owned_turns(sessions)
    lifespan_app.state.workbench_runs = WorkbenchRuns(
        sessions=sessions, settings=settings, load_settings=lifespan_app.state.workbench_settings
    )
    await recover_admissions(sessions=sessions)
    await recover_interrupted_visual_assistant_runs(sessions=sessions)
    await recover_interrupted_model_test_runs(sessions)
    await recover_interrupted_amadeus_runs(sessions=sessions)
    lifespan_app.state.code_agent_runs = CodeAgentRuns(
        sessions=sessions,
        settings=settings,
        skills=lambda session, owner: lifespan_app.state.integration_bindings.skills(
            None, session, owner
        ),
    )
    installer = Installer(local_root(settings))
    local_runtime = LocalRuntime(installer)
    local_models = LocalModels(sessions, installer, local_runtime)
    lifespan_app.state.local_models = local_models
    await local_models.recover()
    supervisor = RunnerSupervisor(
        (
            WorkbenchSyncRunner(
                actor_allowed=workbench_actor_allowed, sessions=sessions, settings=settings
            ),
            InterviewPreparationRunner(
                interview_actor_allowed,
                sessions=sessions,
                executor_status=lifespan_app.state.interview_executor_status,
            ),
            ArticleSyncRunner(
                external_sync_actor_allowed,
                sessions=sessions,
                connections=lifespan_app.state.article_connections,
                asset_metadata=lifespan_app.state.article_assets,
            ),
            ModelTemplateSyncRunner(sessions=sessions),
            VisualGenerationRunner(
                claim_admission=claim_visual_capacity,
                queue_candidates=visual_queue_candidates,
                session_factory=sessions,
                settings=settings,
                decrypt=lifespan_app.state.model_decrypt,
            ),
            AcceptanceRunner(
                actor_allowed=acceptance_actor_allowed,
                session_factory=sessions,
                settings=settings,
                decrypt=lifespan_app.state.model_decrypt,
            ),
            ModelTestGenerationRunner(
                sessions,
                legacy_references=lifespan_app.state.model_generation_legacy_references,
                decrypt=lifespan_app.state.model_decrypt,
                settings=settings,
            ),
            InferenceRunner(
                sessions,
                local_runtime=local_runtime,
                decrypt=lifespan_app.state.model_decrypt,
                settings=settings,
            ),
            ModelTestTranscriptionRunner(
                sessions, decrypt=lifespan_app.state.model_decrypt, settings=settings
            ),
            GalgameAsrRunner(
                session_factory=sessions,
                settings=settings,
                decrypt=lifespan_app.state.model_decrypt,
            ),
            GalgameAnnotationImportRunner(session_factory=sessions, settings=settings),
            GalgameVideoExportRunner(session_factory=sessions, settings=settings),
            GalgameVideoEditorHandoffRunner(session_factory=sessions, settings=settings),
            VideoEditorRunner(session_factory=sessions, settings=settings),
            VideoEditorRunner(lane="media", session_factory=sessions, settings=settings),
            MotionExportRunner(session_factory=sessions, settings=settings),
        )
    )
    lifespan_app.state.runner_supervisor = supervisor
    try:
        await supervisor.start()
        yield
    finally:
        await lifespan_app.state.assistant_approvals.close()
        await lifespan_app.state.video_downloads.close()
        await lifespan_app.state.amadeus_actions.close()
        await lifespan_app.state.code_agent_runs.close()
        await lifespan_app.state.workbench_runs.close()
        await supervisor.stop()
        await local_models.close()
        lifespan_app.state.runner_supervisor = None
        await database.close()
