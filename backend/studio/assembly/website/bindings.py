from __future__ import annotations

import asyncio
import secrets
import time
from functools import partial

from app.console.governance.code_agent_connections import enable_connection
from app.console.governance.code_agents import catalog as code_agent_catalog
from studio.apps.agent_workbench.events import stream_events
from studio.apps.agent_workbench.execution.runner import WorkbenchRuns
from studio.apps.amadeus.execution.website_actions import ActionExecution
from studio.apps.amadeus.execution.website_dialogue import CodeAgentRuns
from studio.apps.asset_library.storage.layout.account_upgrade import upgrade_pending
from studio.apps.audio_annotation.legacy_sources import LegacyAnnotationSources
from studio.apps.audio_annotation.storage.projects import ProjectRecords
from studio.apps.audio_annotation.transcription import legacy_transcribe
from studio.apps.director_desk.agent_session import DirectorEditorSessions
from studio.apps.director_desk.storage.file_paths import DirectorStorage
from studio.apps.gateway.storage.website_resources import WebsiteResources
from studio.apps.gateway.use_cases.resource_links import ResourceLinks
from studio.apps.identity.storage.cloud_factors import FactorRecords
from studio.apps.identity.transport.database_auth import (
    authenticate_database_request,
    authenticate_database_websocket,
)
from studio.apps.identity.use_cases.cloud_factors import CloudFactors
from studio.apps.interview_assistant.executor_status import executor_status
from studio.apps.model_service.admission.bindings import AdmissionBindings
from studio.apps.model_service.admission.website_queue import admit_generation_tasks
from studio.apps.model_service.admission.website_quotas import acquire, attach, release
from studio.apps.model_service.call_logs.credentials import snapshot_from_principal
from studio.apps.model_service.catalog.http_bindings import CatalogBindings
from studio.apps.model_service.catalog.legacy_defaults import LegacyCatalogDefaults
from studio.apps.model_service.catalog.legacy_usage import LegacyCatalogTaskUsage
from studio.apps.model_service.demonstration.execution import DemoRuntime
from studio.apps.model_service.demonstration.website_storage import read_demo_configuration
from studio.apps.model_service.library.inputs import LibraryInputBindings
from studio.apps.model_service.library.outputs import LibraryOutputBindings
from studio.apps.model_service.library.website_inputs import LegacyLibraryInputs
from studio.apps.model_service.library.website_outputs import LegacyLibraryOutputs
from studio.apps.model_service.playground.legacy_generation_references import (
    LegacyGenerationReferences,
)
from studio.apps.model_service.transport.provider_bindings import ProviderTransports
from studio.apps.motion_compositor.legacy_project_resources import LegacyProjectResources
from studio.apps.portal.storage.documents import InstalledDocuments
from studio.apps.portal.use_cases.documents import DeveloperDocuments
from studio.apps.presentation_workshop.exchange.legacy_import import import_legacy_presentation
from studio.apps.presentation_workshop.legacy_project_assets import LegacyProjectAssets
from studio.apps.remote_desktop.storage.preferences import PreferenceRecords
from studio.apps.remote_desktop.use_cases.preferences import DesktopPreferences
from studio.apps.thought_workshop.external_sync.use_cases import ArticleSync
from studio.apps.thought_workshop.legacy_accounts import LegacyAccountDirectory
from studio.apps.thought_workshop.legacy_asset_metadata import LegacyAssetMetadata
from studio.apps.thought_workshop.legacy_writing import LegacyWritingModels
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.apps.thought_workshop.writing import WritingBindings
from studio.apps.tools.storage.navigation import NavigationRecords
from studio.apps.tools.use_cases.navigation import ToolNavigation
from studio.apps.tools.video_downloads.local_jobs import VideoDownloads
from studio.apps.video_editor.assistant_operations import apply_assistant_timeline_batch
from studio.apps.video_editor.legacy_project_layouts import LegacyVideoLayouts
from studio.apps.video_editor.legacy_timeline_assets import LegacyTimelineAssets
from studio.assembly.annotation import document_editor, project_creator
from studio.assembly.website.account_provisioning import create_account
from studio.assembly.website.creative import bind_creative
from studio.assembly.website.desktop import DesktopConnection
from studio.assembly.website.integrations import integration_bindings
from studio.assembly.website.media import bind_media
from studio.assembly.website.models import AUTOMATION_ROOTS, CERTIFIABLE_PROJECT_ROOTS
from studio.assembly.website.video_library import ingest_library
from studio.config import REPO_ROOT
from studio.config.settings import get_cloud_settings
from studio.host.project_files.video_dependencies import probe_deps
from studio.host.project_files.video_execution import _run_yt_dlp
from studio.host.session_collection.access import LocalSourceAccess
from studio.runtime.http.rate_limit import AttemptLimiter
from studio.runtime.secrets import SecretCipher
from studio.runtime.tasks.reactive_tools.approval import ApprovalBroker
from studio.runtime.time import utc_now


def bind_components(app, settings, database):
    bind_creative(app, settings)
    app.state.auth_attempts = AttemptLimiter()
    app.state.assistant_approvals = ApprovalBroker()
    app.state.cloud_factors = CloudFactors(
        FactorRecords(database.sessions, clock=utc_now),
        cipher=SecretCipher(settings.fpl_secrets_key),
        clock=lambda: time.time(),
        secret_bytes=secrets.token_bytes,
    )
    app.state.model_template_cipher = SecretCipher(settings.fpl_secrets_key)
    app.state.developer_documents = DeveloperDocuments(InstalledDocuments(REPO_ROOT))
    app.state.resource_links = lambda _request, session, _principal: ResourceLinks(
        WebsiteResources(session, AUTOMATION_ROOTS)
    )
    app.state.certifiable_projects = CERTIFIABLE_PROJECT_ROOTS
    sessions = database.sessions
    app.state.tool_navigation = ToolNavigation(NavigationRecords(database.sessions), clock=utc_now)
    bind_media(app, settings, sessions)
    app.state.video_downloads = VideoDownloads(
        root=settings.runtime_path / "tool-navigation" / "video-download",
        download=lambda **kwargs: asyncio.to_thread(_run_yt_dlp, **kwargs),
        ingest=partial(ingest_library, sessions=sessions, settings=settings),
        probe=probe_deps,
    )
    app.state.amadeus_actions = ActionExecution(
        partial(apply_assistant_timeline_batch, sessions=sessions), files_root=settings.runtime_path
    )
    app.state.demo_runtime = DemoRuntime(partial(read_demo_configuration, sessions=sessions))
    app.state.interview_executor_status = partial(
        executor_status, sessions=sessions, settings=settings
    )
    app.state.annotation_document_editor = document_editor
    app.state.annotation_project_creator = project_creator
    app.state.annotation_projects = lambda _request, session: ProjectRecords(
        session, sources=LegacyAnnotationSources(session, settings)
    )
    app.state.annotation_transcriber = lambda _request, session: partial(legacy_transcribe, session)
    app.state.annotation_staging = None
    app.state.director_editor = DirectorEditorSessions(sessions)
    app.state.director_storage = DirectorStorage(settings.runtime_path)
    app.state.code_agent_catalog = lambda _request, *, can_enable: code_agent_catalog(
        can_enable=can_enable
    )
    app.state.code_agent_enable = lambda _request, agent_id: enable_connection(agent_id)
    app.state.studio_http_auth = partial(
        authenticate_database_request, allowed_origins=tuple(settings.cors_origin_list)
    )
    app.state.studio_socket_auth = authenticate_database_websocket
    app.state.integration_bindings = integration_bindings(
        settings, app.state.demo_runtime.tool_reply
    )
    app.state.article_connections = lambda session, owner: app.state.integration_bindings.external(
        None, session, owner
    )
    app.state.article_sync = lambda session, owner, principal: ArticleSync(
        session, owner, principal, connections=app.state.article_connections(session, owner)
    )
    app.state.model_catalog_bindings = CatalogBindings(
        defaults=LegacyCatalogDefaults,
        task_usage=LegacyCatalogTaskUsage,
    )
    app.state.model_credential_reader = snapshot_from_principal
    app.state.model_admission = AdmissionBindings(
        partial(acquire, sessions=sessions),
        partial(release, sessions=sessions),
        attach,
        admit_generation_tasks,
    )
    app.state.model_provider_transports = ProviderTransports(
        resolve=app.state.demo_runtime.mock_transport
    )
    app.state.model_library_outputs = LibraryOutputBindings(
        for_request=lambda _request, session, owner: LegacyLibraryOutputs(session, settings, owner)
    )
    app.state.model_generation_legacy_references = LegacyGenerationReferences(settings)
    app.state.model_library_inputs = LibraryInputBindings(
        for_request=lambda _request, session, owner: LegacyLibraryInputs(session, settings, owner)
    )

    sessions.configure(
        info={
            **sessions.kw.get("info", {}),
            "thought_asset_metadata_factory": LegacyAssetMetadata,
            "presentation_project_assets": LegacyProjectAssets,
            "motion_project_resources": LegacyProjectResources,
            "video_project_layouts": LegacyVideoLayouts,
            "video_timeline_assets": LegacyTimelineAssets,
            "presentation_import": import_legacy_presentation,
        }
    )

    app.state.thought_directory = DirectoryBindings(
        for_request=lambda _request, session, _principal: LegacyAccountDirectory(session)
    )
    app.state.thought_writing = WritingBindings(
        for_request=lambda _request, owner: LegacyWritingModels(
            sessions, owner, transport_resolver=app.state.demo_runtime.mock_transport
        )
    )
    app.state.workbench_native = LocalSourceAccess()
    app.state.workbench_event_stream = partial(stream_events, sessions=sessions)
    app.state.account_creator = create_account
    app.state.account_storage_check = upgrade_pending
    app.state.code_agent_runs = CodeAgentRuns(
        sessions=sessions,
        settings=settings,
        skills=lambda session, owner: app.state.integration_bindings.skills(None, session, owner),
    )
    app.state.desktop_preferences = DesktopPreferences(PreferenceRecords(sessions))
    app.state.cloud_desktop = DesktopConnection(
        sessions=sessions,
        settings_reader=get_cloud_settings,
        attempts=app.state.auth_attempts,
        preferences=app.state.desktop_preferences,
    )
    app.state.workbench_runs = WorkbenchRuns(sessions=sessions, settings=settings)
