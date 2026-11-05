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
from app.console.governance.database_auth import (
    authenticate_database_request,
    authenticate_database_websocket,
)
from app.console.governance.demo_configuration import read_demo_configuration
from app.console.governance.generation_queue import (
    admit_generation_tasks,
)
from app.console.governance.provisioning import create_account
from app.console.governance.runtime_quotas import acquire, attach, release
from app.demo_runtime.engine import DemoRuntime
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
from app.llm.legacy_library_inputs import LegacyLibraryInputs
from app.llm.legacy_library_outputs import LegacyLibraryOutputs
from app.llm.library_inputs import LibraryInputBindings
from app.llm.library_outputs import LibraryOutputBindings
from app.llm.playground.legacy_generation_references import LegacyGenerationReferences
from app.llm.provider_transports import ProviderTransports
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
from studio.apps.interview_assistant.executor_status import executor_status
from studio.apps.motion_compositor.legacy_project_resources import LegacyProjectResources
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
from studio.config.settings import get_cloud_settings


def bind_components(app, settings, database):
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
    app.state.studio_http_auth = authenticate_database_request
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
        sessions=sessions, settings_reader=get_cloud_settings
    )
    app.state.workbench_runs = WorkbenchRuns(sessions=sessions, settings=settings)
