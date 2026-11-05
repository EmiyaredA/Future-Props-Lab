from __future__ import annotations

import asyncio
from functools import partial

from app.capabilities.agents.sessions.access import LocalSourceAccess
from app.capabilities.asset_store.account_upgrade import upgrade_pending
from app.console.amadeus.actions import ActionExecution
from app.console.amadeus.execution import CodeAgentRuns
from app.console.cloud_control.desktop import DesktopConnection
from app.console.creative_workshop.legacy_archives import LegacyCreativeArchives
from app.console.creative_workshop.legacy_authors import LegacyCreativeAuthors
from app.console.creative_workshop.legacy_install import LegacyCreativeInstaller
from app.console.creative_workshop.legacy_sources import LegacyCreativeSources
from app.console.governance.code_agent_connections import enable_connection
from app.console.governance.code_agents import catalog as code_agent_catalog
from app.integrations.external.catalog import ExternalConnections
from app.integrations.http_bindings import IntegrationBindings
from app.integrations.mcp import McpCatalog
from app.integrations.skills.catalog import SkillCatalog
from app.integrations.tool_apis import ToolApiCatalog
from app.tool_navigation.video_download import VideoDownloads
from app.tool_navigation.video_download_dependencies import probe_deps
from app.tool_navigation.video_download_execution import _run_yt_dlp
from app.tool_navigation.video_download_library import ingest_library
from studio.apps.agent_workbench.events import stream_events
from studio.apps.agent_workbench.execution.runner import WorkbenchRuns
from studio.apps.audio_annotation.legacy_sources import LegacyAnnotationSources
from studio.apps.audio_annotation.projects import AudioAnnotationProjects
from studio.apps.audio_annotation.transcription import legacy_transcribe
from studio.apps.director_desk.agent_session import DirectorEditorSessions
from studio.apps.gateway.storage.website_resources import WebsiteResources
from studio.apps.gateway.use_cases.resource_links import ResourceLinks
from studio.apps.identity.transport.database_auth import (
    authenticate_database_request,
    authenticate_database_websocket,
)
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
from studio.apps.thought_workshop.legacy_accounts import LegacyAccountDirectory
from studio.apps.thought_workshop.legacy_asset_metadata import LegacyAssetMetadata
from studio.apps.thought_workshop.legacy_writing import LegacyWritingModels
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.apps.thought_workshop.writing import WritingBindings
from studio.apps.video_editor.assistant_operations import apply_assistant_timeline_batch
from studio.apps.video_editor.legacy_project_layouts import LegacyVideoLayouts
from studio.apps.video_editor.legacy_timeline_assets import LegacyTimelineAssets
from studio.assembly.annotation import document_editor
from studio.assembly.website.account_provisioning import create_account
from studio.assembly.website.models import AUTOMATION_ROOTS, CERTIFIABLE_PROJECT_ROOTS
from studio.config import REPO_ROOT
from studio.config.settings import get_cloud_settings
from studio.runtime.http.rate_limit import AttemptLimiter


def bind_components(app, settings, database):
    app.state.auth_attempts = AttemptLimiter()
    app.state.developer_documents = DeveloperDocuments(InstalledDocuments(REPO_ROOT))
    app.state.resource_links = lambda _request, session, _principal: ResourceLinks(
        WebsiteResources(session, AUTOMATION_ROOTS)
    )
    app.state.certifiable_projects = CERTIFIABLE_PROJECT_ROOTS
    sessions = database.sessions
    app.state.video_downloads = VideoDownloads(
        root=settings.runtime_path / "tool-navigation" / "video-download",
        download=lambda **kwargs: asyncio.to_thread(_run_yt_dlp, **kwargs),
        ingest=partial(ingest_library, sessions=sessions, settings=settings),
        probe=probe_deps,
    )
    app.state.amadeus_actions = ActionExecution(
        partial(apply_assistant_timeline_batch, sessions=sessions)
    )
    app.state.demo_runtime = DemoRuntime(partial(read_demo_configuration, sessions=sessions))
    app.state.interview_executor_status = partial(
        executor_status, sessions=sessions, settings=settings
    )
    app.state.annotation_document_editor = document_editor
    app.state.annotation_projects = lambda _request, session: AudioAnnotationProjects(
        session, sources=LegacyAnnotationSources(session, settings)
    )
    app.state.annotation_transcriber = lambda _request, session: partial(legacy_transcribe, session)
    app.state.annotation_staging = None
    app.state.director_editor = DirectorEditorSessions(sessions)
    app.state.code_agent_catalog = lambda _request, *, can_enable: code_agent_catalog(
        can_enable=can_enable
    )
    app.state.code_agent_enable = lambda _request, agent_id: enable_connection(agent_id)
    app.state.studio_http_auth = partial(
        authenticate_database_request, allowed_origins=tuple(settings.cors_origin_list)
    )
    app.state.studio_socket_auth = authenticate_database_websocket
    app.state.integration_bindings = IntegrationBindings(
        tool_apis=lambda _request, session, owner: ToolApiCatalog(
            session, owner, demo_tools=app.state.demo_runtime.tool_reply
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
        for_request=lambda _request, owner: LegacyWritingModels(
            sessions, owner, transport_resolver=app.state.demo_runtime.mock_transport
        )
    )
    app.state.workbench_native = LocalSourceAccess()
    app.state.workbench_event_stream = partial(stream_events, sessions=sessions)
    app.state.account_creator = create_account
    app.state.account_storage_check = upgrade_pending
    app.state.code_agent_runs = CodeAgentRuns(sessions=sessions, settings=settings)
    app.state.cloud_desktop = DesktopConnection(
        sessions=sessions, settings_reader=get_cloud_settings, attempts=app.state.auth_attempts
    )
    app.state.workbench_runs = WorkbenchRuns(sessions=sessions, settings=settings)
