"""Serve shared CLI connection contracts with native execution outside the container."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.routes.code_agents import router
from app.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.database import Database
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.native_ingress import NativeIngress
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.request_limit import RequestLimit
from fpl_runtime.visual_agent_review import JOBS, MAX_JOB_BYTES
from fpl_runtime.web import attach_web, load_release

from .acceptance_http import router as acceptance_router
from .host import ConnectionHost
from .migrations.registry import MIGRATIONS
from .models import ConnectionJob, VisualReviewJob
from .native_http import router as native_router
from .review_artifact_sweep import ReviewArtifactSweep
from .review_artifacts import ReviewArtifacts
from .review_host import ReviewHost
from .review_http import UPLOAD
from .review_http import router as review_router

SERVICE = "agent-runtime"


def create_app(
    *,
    state_root,
    public_key,
    catalog,
    options=None,
    transport=None,
    schema_path=None,
    web_root=None,
):
    database = Database(
        SERVICE, state_root, models=(ConnectionJob, VisualReviewJob), hide_parameters=True
    )
    identity = (
        LiveAuthorization(
            service=SERVICE, credential=options.identity_credential, transport=transport
        )
        if options is not None
        else None
    )
    host = ConnectionHost(database, identity)
    artifacts = ReviewArtifacts(state_root)
    sweep = ReviewArtifactSweep(database, artifacts)
    capabilities = (
        CapabilityClient(
            service=SERVICE,
            credential=options.identity_credential,
            catalog=catalog,
            transport=transport,
        )
        if options is not None
        else None
    )

    reviews = ReviewHost(database, identity, capabilities)

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                await host.recover()
                await sweep.start()
                yield
            finally:
                await sweep.stop()
                if identity is not None:
                    await identity.close()
                    await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Agent Runtime",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.database = database
    app.state.identity_public_key = public_key
    app.state.connections = host
    app.state.visual_reviews = reviews
    app.state.review_artifacts = artifacts
    app.state.code_agent_catalog = host.catalog
    app.state.code_agent_enable = host.enable
    app.include_router(router, prefix="/v1")
    app.include_router(native_router)
    app.include_router(acceptance_router)
    app.include_router(review_router)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_middleware(
        RequestLimit,
        prefix="/_native/",
        maximum=MAX_JOB_BYTES + 32 * 1024,
        streaming_prefix=UPLOAD + "/",
    )
    app.add_middleware(RequestLimit, prefix=JOBS, maximum=MAX_JOB_BYTES)
    app.add_middleware(NativeIngress, options=options)
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)

    if schema_path is not None:
        expected = public_contract(json.loads(schema_path.read_text()), SERVICE, catalog)
        if public_contract(app.openapi(), SERVICE, catalog) != expected:
            raise ValueError("编程智能体 API 与发布契约不匹配")
    if web_root is not None:
        release = load_release(web_root, SERVICE)
        if schema_path is None or release.api_sha256 != expected:
            raise ValueError("编程智能体浏览器程序与发布契约不匹配")
        attach_web(app, release, pages=("/code-agents", "/code-agents/"))

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        if options is None or not host.ready or not reviews.ready or not sweep.is_healthy:
            raise HTTPException(503, "agent_runtime_workers_unavailable")
        check(database.path, SERVICE, MIGRATIONS)
        return {"status": "ok", "service": SERVICE}

    return app
