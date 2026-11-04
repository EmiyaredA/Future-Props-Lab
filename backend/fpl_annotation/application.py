"""Standalone Annotation with request-bound Assets and its own project store."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from app.apps.audio_annotation.routes import router
from app.apps.audio_annotation.sources import AudioAnnotationError
from app.deps import db_session, require_studio_auth
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime, reference_lifespan
from fpl_runtime.web import attach_web, load_release

from .migrations.registry import MIGRATIONS
from .models import MODELS, AnnotationReferenceMutation
from .sources import Inputs, ProjectReferences, transcription_unavailable

SERVICE = "annotation"
PAGES = (
    "/apps/audio-annotation",
    "/apps/audio-annotation/",
    "/apps/audio-annotation/projects/{project_id}",
    "/apps/audio-annotation/projects/{project_id}/",
)


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    credential,
    schema_path=None,
    web_root=None,
    transport=None,
    run_worker=True,
):
    database = Database(SERVICE, state_root, models=MODELS)
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )
    staging = database.root / ".staging"

    @asynccontextmanager
    async def lifespan(app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                if staging.is_symlink():
                    raise ValueError("音频暂存目录不能是符号链接")
                staging.mkdir(exist_ok=True, mode=0o700)
                async with reference_lifespan(app):
                    yield
            finally:
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Annotation", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    install_reference_runtime(
        app,
        service=SERVICE,
        model=AnnotationReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )

    async def request_session(connection: HTTPConnection):
        async with database.sessions() as session:
            session.info.update(
                annotation_sources=lambda db: Inputs(connection, db, capabilities, staging),
                annotation_references=ProjectReferences(
                    connection, session, app.state.reference_mutations
                ),
                annotation_transcribe=transcription_unavailable,
                annotation_staging=staging,
            )
            yield session

    async def annotation_error(request, exc):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    app.dependency_overrides[db_session] = request_session
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_exception_handler(AudioAnnotationError, annotation_error)
    app.include_router(router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    if schema_path is not None:
        expected = public_contract(json.loads(schema_path.read_text()), SERVICE, catalog)
        if public_contract(app.openapi(), SERVICE, catalog) != expected:
            raise ValueError("音频标注 API 与发布契约不匹配")
    if web_root is not None:
        release = load_release(web_root, SERVICE)
        if schema_path is None or release.api_sha256 != expected:
            raise ValueError("音频标注浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "annotation_cutover_incomplete")

    return app
