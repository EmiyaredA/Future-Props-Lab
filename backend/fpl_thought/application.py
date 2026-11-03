"""Fail-closed assembly for the independent Thought service under construction."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from sqlalchemy import text

from app.apps.thought_workshop.account_directory import DirectoryBindings
from app.apps.thought_workshop.asset_metadata import AssetMetadataBindings
from app.problem_details import revision_conflict_handler
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.request_limit import RequestLimit

from .account_directory import HttpAccountDirectory
from .asset_metadata import HttpAssetMetadata
from .community_evidence import CommunityEvidenceVerifier
from .community_evidence import router as evidence_router
from .community_http import CommunityFiles
from .community_http import router as community_files_router
from .community_reads import router as community_reads_router
from .migrations.registry import MIGRATIONS
from .models import ACCOUNT_MODELS, MODELS
from .mutations_http import router as mutations_router
from .reads_http import router as reads_router
from .retention import ThoughtReferenceDelivery, ThoughtReferences


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
):
    if not isinstance(credential, str) or len(credential) < 32:
        raise ValueError("Thought 需要专属身份凭据")
    if (
        not isinstance(assets_peer_credential, str)
        or len(assets_peer_credential) < 32
        or credential == assets_peer_credential
    ):
        raise ValueError("Thought 社区证据需要独立 Assets 对等凭据")
    database = Database("thought", state_root, models=MODELS, account_models=ACCOUNT_MODELS)
    references = ThoughtReferences(database.sessions, retention_client, public_key=public_key)
    delivery = ThoughtReferenceDelivery(database.sessions, retention_client)
    files = CommunityFiles(credential=credential, public_key=public_key, transport=transport)

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

    @asynccontextmanager
    async def lifespan(_app):
        # Recovery may resolve undecided prepares only while no older process can commit.
        with service_lock(state_root):
            try:
                check(database.path, "thought", MIGRATIONS)
                if run_worker:
                    await delivery.start()
                yield
            finally:
                await delivery.stop()
                await files.close()
                await retention_client.close()
                await identity.close()
                await database.close()

    app = FastAPI(
        title="FPL Thought (incomplete)",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "thought"
    app.state.database, app.state.identity = database, identity
    app.state.thought_references, app.state.community_files = references, files
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
    app.state.thought_assets = AssetMetadataBindings(
        lambda request, _session, _principal: HttpAssetMetadata(
            assertion=request.state.service_assertion,
            source_method=request.method,
            source_path=request.url.path,
            credential=credential,
            catalog=catalog,
            transport=transport,
        )
    )
    app.include_router(reads_router, prefix="/v1")
    app.include_router(mutations_router, prefix="/v1")
    app.include_router(community_files_router, prefix="/v1")
    app.include_router(community_reads_router, prefix="/v1")
    app.include_router(evidence_router)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_middleware(SignedIdentity, service="thought", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/_internal/v1/community-evidence/", maximum=32 * 1024)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "thought"}

    @app.get("/ready")
    async def ready():
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        # Other public operations and import/upload recovery are still not wired.
        raise HTTPException(503, "thought_assembly_incomplete")

    return app
