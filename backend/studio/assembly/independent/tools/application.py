"""Independent Tools owner for account favorites and recent usage."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.deps import require_studio_auth
from app.tool_navigation.models import ToolNavigationItem
from app.tool_navigation.routes import router
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.tools.host import ToolsHost
from studio.apps.tools.storage.migrations.registry import MIGRATIONS
from studio.apps.tools.storage.service_models import ToolsDownloadArtifact, ToolsNativeJob
from studio.apps.tools.transport.host_http import NativeIngress, native, public
from studio.apps.tools.video_library import VideoLibrary
from studio.apps.tools.videos import Videos
from studio.contracts.gateway.protocol_hash import public_contract
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.http.web import attach_web, load_release
from studio.runtime.lifecycle.locking import service_lock

PAGES = ("/tools", "/tools/video-frame-exporter", "/tools/video-downloader")


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    web_root=None,
    schema_path=None,
    native_options=None,
    identity_transport=None,
):
    database = Database(
        "tools", state_root, models=(ToolNavigationItem, ToolsNativeJob, ToolsDownloadArtifact)
    )
    identity = (
        LiveAuthorization(
            service="tools",
            credential=native_options.identity_credential,
            transport=identity_transport,
        )
        if native_options
        else None
    )

    capabilities = (
        CapabilityClient(
            service="tools",
            credential=native_options.identity_credential,
            catalog=catalog,
            transport=identity_transport,
        )
        if native_options
        else None
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "tools", MIGRATIONS)
                yield
            finally:
                if identity is not None:
                    await identity.close()
                if capabilities is not None:
                    await capabilities.client.aclose()
                await database.close()

    app = FastAPI(
        title="FPL Tools", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.identity_public_key = public_key
    app.state.tools_host = ToolsHost(database, identity)
    app.state.tools_videos = Videos(app.state.tools_host, VideoLibrary(capabilities))
    for operation in ("claim", "authorize", "heartbeat", "receipt"):
        app.add_middleware(RequestLimit, prefix=f"/_native/v1/{operation}", maximum=32 * 1024)
    app.add_middleware(NativeIngress, options=native_options)
    app.add_middleware(SignedIdentity, service="tools", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.include_router(router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    app.include_router(public)
    app.include_router(native)
    if web_root is not None:
        if schema_path is None:
            raise ValueError("Tools 浏览器程序缺少发布契约")
        release = load_release(web_root, "tools")
        published = json.loads(schema_path.read_text())
        expected_hash = public_contract(published, "tools", catalog)
        if public_contract(app.openapi(), "tools", catalog) != expected_hash:
            raise ValueError("Tools 公开接口与发布契约不匹配")
        if release.api_sha256 != expected_hash:
            raise ValueError("Tools 浏览器程序与发布契约不匹配")
        pages = [path for page in PAGES for path in (page, page + "/")]
        attach_web(app, release, pages=pages)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "tools"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "tools_cutover_incomplete")

    return app
