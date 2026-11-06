from __future__ import annotations

import asyncio
from functools import partial

from studio.apps.amadeus.execution.website_actions import ActionExecution
from studio.apps.amadeus.execution.website_dialogue import CodeAgentRuns
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.layout.account_upgrade import upgrade_pending
from studio.apps.audio_annotation.storage.projects import ProjectRecords
from studio.apps.director_desk.agent_session import DirectorEditorSessions
from studio.apps.director_desk.storage.file_paths import DirectorStorage
from studio.apps.gateway.storage.website_resources import WebsiteResources
from studio.apps.gateway.use_cases.resource_links import ResourceLinks
from studio.apps.identity.storage.cloud_unlock import CloudUnlockRecords
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
from studio.apps.model_service.transcription.annotation import AnnotationTranscription
from studio.apps.model_service.transport.provider_bindings import ProviderTransports
from studio.apps.motion_compositor.legacy_project_resources import LegacyProjectResources
from studio.apps.motion_compositor.projects import MotionProjects
from studio.apps.portal.storage.documents import InstalledDocuments
from studio.apps.portal.use_cases.documents import DeveloperDocuments
from studio.apps.presentation_workshop.exchange.legacy_import import import_legacy_presentation
from studio.apps.presentation_workshop.legacy_project_assets import LegacyProjectAssets
from studio.apps.presentation_workshop.projects import Presentations
from studio.apps.remote_desktop.storage.preferences import PreferenceRecords
from studio.apps.remote_desktop.use_cases.preferences import DesktopPreferences
from studio.apps.thought_workshop.archives.backup import BackupLimits
from studio.apps.thought_workshop.external_sync.use_cases import ArticleSync
from studio.apps.thought_workshop.legacy_accounts import LegacyAccountDirectory
from studio.apps.thought_workshop.legacy_asset_metadata import LegacyAssetMetadata
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.apps.thought_workshop.website.asset_metadata import AssetMetadataBindings
from studio.apps.thought_workshop.writing import WritingBindings
from studio.apps.tools.storage.navigation import NavigationRecords
from studio.apps.tools.use_cases.navigation import ToolNavigation
from studio.apps.tools.video_downloads.local_jobs import VideoDownloads
from studio.apps.video_editor.assistant_operations import apply_assistant_timeline_batch
from studio.apps.video_editor.handoffs.motion_handoff import import_motion_export
from studio.apps.video_editor.legacy_project_layouts import LegacyVideoLayouts
from studio.apps.video_editor.legacy_timeline_assets import LegacyTimelineAssets
from studio.assembly.annotation import (
    document_editor,
    project_creator,
    project_deleter,
    saved_audio,
    segment_transcriber,
)
from studio.assembly.website.account_provisioning import create_account
from studio.assembly.website.annotation_imports import WebsiteCreationInputs
from studio.assembly.website.annotation_sources import WebsiteAnnotationSources
from studio.assembly.website.annotation_transcription import WebsiteTranscription
from studio.assembly.website.code_agent_access import resolve
from studio.assembly.website.creative import bind_creative
from studio.assembly.website.desktop import DesktopConnection
from studio.assembly.website.integrations import integration_bindings
from studio.assembly.website.media import bind_media
from studio.assembly.website.models import AUTOMATION_ROOTS, CERTIFIABLE_PROJECT_ROOTS
from studio.assembly.website.remote_apps import RemoteApps
from studio.assembly.website.thought_writing import WebsiteWritingModels
from studio.assembly.website.video_library import ingest_library
from studio.config import CONFIG_FILE, REPO_ROOT
from studio.host.agent_execution.cli.connection_configuration import enable_connection
from studio.host.agent_execution.cli.connections import catalog as code_agent_catalog
from studio.host.project_files.video_dependencies import probe_deps
from studio.host.project_files.video_execution import _run_yt_dlp
from studio.runtime.files.raster import RasterPreviews
from studio.runtime.http.rate_limit import AttemptLimiter
from studio.runtime.secrets import SecretCipher
from studio.runtime.tasks.reactive_tools.approval import ApprovalBroker
from studio.runtime.time import utc_now


def bind_components(app, settings, database, *, read_cloud_settings):
    app.state.raster_previews = RasterPreviews(capacity=2)
    app.state.avatar_previews = RasterPreviews(capacity=1)
    bind_creative(app, settings)
    app.state.auth_attempts = AttemptLimiter()
    app.state.invitation_cipher = SecretCipher(settings.fpl_secrets_key)
    app.state.management_api_key_cipher = SecretCipher(settings.fpl_secrets_key)
    app.state.assistant_approvals = ApprovalBroker()
    app.state.cloud_unlocks = CloudUnlockRecords(
        database.sessions, clock=utc_now, settings_reader=read_cloud_settings
    )
    app.state.model_template_cipher = SecretCipher(settings.fpl_secrets_key)
    app.state.model_decrypt = app.state.model_template_cipher.decrypt
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
    video_layouts = partial(LegacyVideoLayouts, storage=AssetStorage(settings))
    app.state.video_layouts = lambda _request, session, owner: video_layouts(session, owner)
    app.state.video_assets = lambda _request, session, owner: LegacyTimelineAssets(session, owner)

    async def import_motion_video(session, owner, source, **details):
        return await import_motion_export(
            session,
            owner,
            source,
            settings=settings,
            layouts=video_layouts(session, owner),
            assets=LegacyTimelineAssets(session, owner),
            **details,
        )

    app.state.motion_video_import = import_motion_video
    app.state.amadeus_resolve = lambda session, owner, user, agent, *, probe=True: resolve(
        session, owner, user, agent, "amadeus", settings=read_cloud_settings(), probe=probe
    )
    app.state.amadeus_actions = ActionExecution(
        partial(
            apply_assistant_timeline_batch, sessions=sessions, asset_reader=LegacyTimelineAssets
        ),
        files_root=settings.runtime_path,
        resolve_agent=app.state.amadeus_resolve,
    )
    app.state.demo_runtime = DemoRuntime(partial(read_demo_configuration, sessions=sessions))
    app.state.interview_files_root = settings.runtime_path
    app.state.interview_executor_status = lambda user, owner="", session=None: executor_status(
        user, owner, session, sessions=sessions, settings=read_cloud_settings()
    )
    app.state.annotation_document_editor = document_editor
    app.state.annotation_project_creator = project_creator
    app.state.annotation_creation_inputs = lambda _request, session, sources: WebsiteCreationInputs(
        sources=sources, session=session, settings=settings
    )
    app.state.annotation_project_deleter = project_deleter
    app.state.annotation_saved_audio = saved_audio
    app.state.annotation_projects = lambda _request, session: ProjectRecords(
        session, sources=WebsiteAnnotationSources(session, settings)
    )
    annotation_cipher = SecretCipher(settings.fpl_secrets_key)
    app.state.annotation_transcriber = segment_transcriber
    app.state.annotation_executor = lambda _request, session: WebsiteTranscription(
        session, AnnotationTranscription(session, decrypt=annotation_cipher.decrypt)
    )
    app.state.annotation_staging = None
    app.state.director_editor = DirectorEditorSessions(sessions)
    app.state.director_storage = DirectorStorage(settings.runtime_path)
    app.state.code_agent_catalog = lambda _request, *, can_enable: code_agent_catalog(
        settings=read_cloud_settings(), can_enable=can_enable
    )
    app.state.code_agent_enable = lambda _request, agent_id: enable_connection(
        agent_id, config_file=CONFIG_FILE, read_settings=read_cloud_settings
    )
    app.state.studio_http_auth = partial(
        authenticate_database_request,
        sessions=sessions,
        allowed_origins=tuple(settings.cors_origin_list),
    )
    app.state.studio_socket_auth = authenticate_database_websocket
    app.state.integration_bindings = integration_bindings(
        settings, app.state.demo_runtime.tool_reply
    )
    app.state.article_connections = lambda session, owner: app.state.integration_bindings.external(
        None, session, owner
    )
    app.state.article_sync = lambda session, owner, principal: ArticleSync(
        session,
        owner,
        principal,
        connections=app.state.article_connections(session, owner),
        assets=thought_metadata(session, owner),
    )
    app.state.require_native_model_retention = False
    app.state.model_catalog_bindings = CatalogBindings(
        defaults=LegacyCatalogDefaults,
        task_usage=LegacyCatalogTaskUsage,
        cipher=SecretCipher(settings.fpl_secrets_key),
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

    def thought_metadata(session, owner):
        return LegacyAssetMetadata(session, owner, storage=AssetStorage(settings))

    app.state.article_assets = thought_metadata
    app.state.thought_source_assets = thought_metadata
    app.state.thought_assets = AssetMetadataBindings(
        for_request=lambda _request, session, principal: thought_metadata(
            session, principal.user_id
        )
    )
    app.state.thought_backup_limits = BackupLimits(
        maximum_files=settings.fpl_project_snapshot_max_files,
        maximum_bytes=settings.fpl_project_snapshot_max_bytes,
    )
    motion_storage = AssetStorage(settings)
    app.state.motion_projects = lambda _request, session, owner: MotionProjects(
        session, owner, resources=LegacyProjectResources(session, owner, storage=motion_storage)
    )
    presentation_storage = AssetStorage(settings)
    app.state.presentation_projects = lambda _request, session, owner: Presentations(
        session,
        owner,
        asset_access=LegacyProjectAssets(session, owner, storage=presentation_storage),
        retention=None,
    )
    import_presentation = partial(import_legacy_presentation, settings=settings)
    app.state.presentation_importer = lambda _request: import_presentation
    app.state.thought_directory = DirectoryBindings(
        for_request=lambda _request, session, _principal: LegacyAccountDirectory(session)
    )
    app.state.thought_writing = WritingBindings(
        for_request=lambda _request, owner: WebsiteWritingModels(
            sessions,
            owner,
            transport_resolver=app.state.demo_runtime.mock_transport,
            decrypt=app.state.model_template_cipher.decrypt,
        )
    )
    app.state.account_creator = create_account
    app.state.account_storage_check = upgrade_pending
    app.state.code_agent_runs = CodeAgentRuns(
        resolve_agent=app.state.amadeus_resolve,
        sessions=sessions,
        settings=settings,
        skills=lambda session, owner: app.state.integration_bindings.skills(None, session, owner),
    )
    app.state.desktop_preferences = DesktopPreferences(PreferenceRecords(sessions))
    app.state.remote_apps = RemoteApps(
        sessions=sessions,
        preferences=app.state.desktop_preferences,
        read_cloud_settings=read_cloud_settings,
    )
    app.state.cloud_desktop = DesktopConnection(
        sessions=sessions,
        settings_reader=read_cloud_settings,
        attempts=app.state.auth_attempts,
        preferences=app.state.desktop_preferences,
    )
