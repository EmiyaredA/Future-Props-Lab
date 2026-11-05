"""Fail-closed assembly for the independent Thought service under construction."""

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from studio.apps.integrations.clients.authority import IntegrationIntentClient
from studio.apps.thought_workshop.account_directory import HttpAccountDirectory
from studio.apps.thought_workshop.archives.archive_delivery import ArchiveDelivery
from studio.apps.thought_workshop.archives.archive_transport import ArchiveTransport
from studio.apps.thought_workshop.archives.backup import BackupLimits
from studio.apps.thought_workshop.asset_metadata import HttpAssetMetadata
from studio.apps.thought_workshop.community.community_evidence import CommunityEvidenceVerifier
from studio.apps.thought_workshop.community.community_evidence import router as evidence_router
from studio.apps.thought_workshop.community.community_reads import router as community_reads_router
from studio.apps.thought_workshop.community.community_upload import CommunityUploadDelivery
from studio.apps.thought_workshop.content_exports_http import router as content_exports_router
from studio.apps.thought_workshop.external_sync.records_http import router as sync_records_router
from studio.apps.thought_workshop.knowledge_tools.http import router as knowledge_tools_router
from studio.apps.thought_workshop.multitable.query_http import router as table_query_router
from studio.apps.thought_workshop.publication.http import router as community_metadata_router
from studio.apps.thought_workshop.retention import ThoughtReferenceDelivery, ThoughtReferences
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.apps.thought_workshop.synchronization.sync_artifacts import SyncArtifacts
from studio.apps.thought_workshop.synchronization.sync_binding import router as sync_binding_router
from studio.apps.thought_workshop.synchronization.sync_runner import SyncRunner
from studio.apps.thought_workshop.synchronization.sync_transport import TaskSyncTransport
from studio.apps.thought_workshop.transport.archive_http import router as archive_router
from studio.apps.thought_workshop.transport.backup_http import router as backup_router
from studio.apps.thought_workshop.transport.community_http import CommunityFiles
from studio.apps.thought_workshop.transport.community_http import router as community_files_router
from studio.apps.thought_workshop.transport.community_writes_http import (
    router as community_writes_router,
)
from studio.apps.thought_workshop.transport.mutations_http import router as mutations_router
from studio.apps.thought_workshop.transport.publication_http import router as publication_router
from studio.apps.thought_workshop.transport.reads_http import router as reads_router
from studio.apps.thought_workshop.transport.upload_http import UploadConfiguration
from studio.apps.thought_workshop.transport.upload_http import router as upload_router
from studio.apps.thought_workshop.uploads.upload_recovery import recover_upload_staging
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.apps.thought_workshop.website.asset_metadata import AssetMetadataBindings
from studio.apps.thought_workshop.writing import WritingBindings
from studio.apps.thought_workshop.writing_http import router as writing_router
from studio.apps.thought_workshop.writing_models import HttpWritingModels
from studio.contracts.gateway.protocol_hash import public_contract
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.lifecycle.locking import service_lock
from studio.runtime.revisions import RevisionConflictError


def create_app(
    *,
    state_root: Path,
    catalog,
    public_key,
    credential,
    identity,
    retention_client,
    assets_peer_credential,
    transport=None,
    run_worker=True,
    upload_receipt_credential=None,
    upload_maximum_bytes=200 * 1024 * 1024,
    backup_limits=BackupLimits(),
    schema_path=None,
    web_root=None,
    version="development",
):
    if not isinstance(credential, str) or len(credential) < 32:
        raise ValueError("Thought 需要专属身份凭据")
    if (
        not isinstance(assets_peer_credential, str)
        or len(assets_peer_credential) < 32
        or credential == assets_peer_credential
    ):
        raise ValueError("Thought 社区证据需要独立 Assets 对等凭据")
    if type(upload_maximum_bytes) is not int or upload_maximum_bytes < 1:
        raise ValueError("Thought 上传大小限制无效")
    if upload_receipt_credential is not None:
        from studio.contracts.thought_workshop.thought_uploads import (
            ThoughtUploadReceiptAuthenticator,
        )

        ThoughtUploadReceiptAuthenticator(upload_receipt_credential)
        if upload_receipt_credential in {credential, assets_peer_credential}:
            raise ValueError("Thought 上传回执凭据必须独立")
    database = Database("thought", state_root, models=MODELS, account_models=ACCOUNT_MODELS)
    archives = (
        ArchiveDelivery(
            database.sessions,
            ArchiveTransport(
                credential=credential,
                peer_key=upload_receipt_credential,
                catalog=catalog,
                transport=transport,
            ),
            state_root / "archive-staging",
        )
        if upload_receipt_credential is not None
        else None
    )
    community_uploads = (
        CommunityUploadDelivery(database.sessions, archives.transport) if archives else None
    )
    references = ThoughtReferences(database.sessions, retention_client, public_key=public_key)
    delivery = ThoughtReferenceDelivery(database.sessions, retention_client)
    files = CommunityFiles(credential=credential, public_key=public_key, transport=transport)
    sync_reads = CapabilityClient(
        service="thought", credential=credential, catalog=catalog, transport=transport
    )
    sync_intents = IntegrationIntentClient(
        service="thought", credential=credential, transport=transport
    )
    sync_artifacts = SyncArtifacts(state_root)
    sync_transport = TaskSyncTransport(sync_reads, sync_intents)
    sync_runner = SyncRunner(database.sessions, sync_transport, sync_artifacts)

    def directory(principal, assertion, method, path):
        return HttpAccountDirectory(
            principal=principal,
            assertion=assertion,
            source_method=method,
            source_path=path,
            credential=credential,
            catalog=catalog,
            transport=transport,
        )

    def asset_metadata(request, _session, _principal):
        path = request.url.path
        limits = (
            {"maximum_bytes": backup_limits.maximum_bytes}
            if path == "/v1/thought-workshop/backup"
            else {}
        )
        return HttpAssetMetadata(
            assertion=request.state.service_assertion,
            source_method=request.method,
            source_path=path,
            credential=credential,
            catalog=catalog,
            transport=transport,
            **limits,
        )

    @asynccontextmanager
    async def lifespan(_app):
        # Recovery may resolve undecided prepares only while no older process can commit.
        with service_lock(state_root):
            try:
                check(database.path, "thought", MIGRATIONS)
                await recover_upload_staging(state_root, database.sessions)
                if run_worker:
                    await delivery.start()
                    await sync_runner.start()
                    if archives is not None:
                        await archives.start()
                    if community_uploads is not None:
                        await community_uploads.start()
                yield
            finally:
                if community_uploads is not None:
                    await community_uploads.stop()
                if archives is not None:
                    await archives.stop()
                    await archives.transport.close()
                await sync_runner.stop()
                await delivery.stop()
                await files.close()
                await sync_reads.close()
                await sync_intents.close()
                await retention_client.close()
                await identity.close()
                await database.close()

    app = FastAPI(
        title="FPL Thought",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "thought"
    app.state.database, app.state.identity = database, identity
    app.state.thought_backup_limits = backup_limits
    app.state.thought_archive_delivery = archives
    app.state.thought_community_uploads = community_uploads
    app.state.thought_references, app.state.community_files = references, files
    app.state.thought_sync_reads = sync_reads
    app.state.thought_sync_intents = sync_intents
    app.state.thought_sync_artifacts = sync_artifacts
    app.state.thought_sync_transport = sync_transport
    app.state.thought_sync_runner = sync_runner
    if upload_receipt_credential is not None:
        app.state.thought_upload_configuration = UploadConfiguration(
            root=state_root,
            credential=credential,
            receipt_credential=upload_receipt_credential,
            catalog=catalog,
            transport=transport,
            maximum_bytes=upload_maximum_bytes,
        )
    app.state.assets_community_peer_token = assets_peer_credential
    app.state.community_evidence = CommunityEvidenceVerifier(
        database,
        public_key=public_key,
        identity=identity,
        directory_factory=lambda principal, source: directory(
            principal, source.source_assertion, source.source_method, source.source_path
        ),
    )
    app.state.thought_directory = DirectoryBindings(
        lambda request, _session, principal: directory(
            principal, request.state.service_assertion, request.method, request.url.path
        )
    )
    app.state.thought_assets = AssetMetadataBindings(asset_metadata)
    app.state.thought_writing = WritingBindings(
        lambda request, _owner: HttpWritingModels(
            assertion=request.state.service_assertion,
            source_method=request.method,
            source_path=request.url.path,
            credential=credential,
            catalog=catalog,
            transport=transport,
        )
    )
    app.include_router(reads_router, prefix="/v1")
    app.include_router(backup_router, prefix="/v1")
    app.include_router(archive_router, prefix="/v1")
    app.include_router(content_exports_router, prefix="/v1")
    app.include_router(sync_records_router, prefix="/v1")
    app.include_router(sync_binding_router, prefix="/v1")
    app.include_router(writing_router, prefix="/v1/thought-workshop", tags=["thought-workshop"])
    app.include_router(
        table_query_router,
        prefix="/v1/thought-workshop/notes/{note_id}/multitable",
        tags=["thought-workshop", "thought-multitable"],
    )
    app.include_router(
        knowledge_tools_router, prefix="/v1/thought-workshop", tags=["thought-workshop"]
    )
    app.include_router(mutations_router, prefix="/v1")
    app.include_router(upload_router, prefix="/v1")
    app.include_router(community_files_router, prefix="/v1")
    app.include_router(community_reads_router, prefix="/v1")
    app.include_router(community_writes_router, prefix="/v1")
    app.include_router(publication_router, prefix="/v1")
    app.include_router(
        community_metadata_router,
        prefix="/v1/thought-workshop/community",
        tags=["knowledge-community"],
    )
    app.include_router(evidence_router)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_middleware(SignedIdentity, service="thought", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/_internal/v1/community-evidence/", maximum=32 * 1024)

    contract_hash = None
    if schema_path is not None:
        published = json.loads(schema_path.read_text())
        expected = {
            (entry.method, entry.path): entry.operation_id
            for entry in catalog.operations
            if entry.service == "thought"
        }
        actual = {
            (method.upper(), path): operation["operationId"]
            for path, operations in app.openapi()["paths"].items()
            if path.startswith("/v1/")
            for method, operation in operations.items()
        }
        if actual != expected:
            raise ValueError("Thought 路由或操作 ID 与发布清单不匹配")
        contract_hash = public_contract(published, "thought", catalog)
        if public_contract(app.openapi(), "thought", catalog) != contract_hash:
            raise ValueError("Thought 公开接口与发布契约不匹配")
    if web_root is not None:
        from studio.runtime.http.web import attach_web, load_release

        release = load_release(web_root, "thought")
        if release.api_sha256 != contract_hash:
            raise ValueError("Thought 页面与公开契约不匹配")
        page = "/apps/thought-workshop"
        attach_web(app, release, pages=(page, page + "/", page + "/{path:path}"))

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "thought"}

    @app.get("/ready")
    async def ready():
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        if (
            schema_path is None
            or archives is None
            or not all(
                runner.is_healthy for runner in (delivery, sync_runner, archives, community_uploads)
            )
        ):
            raise HTTPException(503, "thought_dependencies_incomplete")
        return {"status": "ready", "service": "thought", "version": version}

    return app
