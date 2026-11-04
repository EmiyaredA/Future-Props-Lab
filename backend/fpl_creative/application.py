"""Independent Creative catalog backed by its own database and Identity peer."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.routes.creative_workshop import catalog_router
from app.deps import db_session
from app.problem_details import http_exception_handler, validation_exception_handler
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.creative_install_evidence import INSTALL_PATH, MAX_BODY
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.request_limit import RequestLimit

from .authors import HttpCreativeAuthors
from .decision_http import InstallDecisionEndpoint
from .decision_http import router as decision_router
from .install_authorization import IdentityInstallAuthorization
from .install_grants import InstallGrantAuthority
from .install_target import HttpCreativeInstallTarget
from .installation_coordinator import InstallationCoordinator
from .installation_http import router as installation_router
from .installation_outbox import InstallationOutbox
from .migrations.registry import MIGRATIONS
from .skill_archive import CreativeSkillArchives, SkillArchivePacker
from .storage import creative_database


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    credential,
    transport=None,
    install_credentials=None,
    web_root=None,
    schema_path=None,
    version="development",
):
    if not isinstance(credential, str) or not credential.isascii() or len(credential) < 32:
        raise ValueError("Creative 需要专属身份凭据")
    database = creative_database(state_root)
    identity = LiveAuthorization(service="creative", credential=credential, transport=transport)

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "creative", MIGRATIONS)
                yield
            finally:
                await identity.close()
                await database.close()

    app = FastAPI(
        title="FPL Creative",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id, app.state.database = "creative", database

    async def request_session(request: Request):
        assertion = request.state.service_assertion
        method, path = request.method, request.url.path
        current = await identity.status(assertion=assertion, method=method, path=path)
        if current is None:
            raise HTTPException(503, "creative_identity_unavailable")
        if current is not True:
            raise HTTPException(401, "creative_authorization_revoked")
        authors = HttpCreativeAuthors(
            assertion=assertion,
            method=method,
            path=path,
            credential=credential,
            transport=transport,
        )
        async with database.sessions(info={"creative_authors": authors}) as session:
            yield session

    app.dependency_overrides[db_session] = request_session
    app.include_router(catalog_router, prefix="/v1/creative-workshop", tags=["creative-workshop"])
    if install_credentials is not None:
        peer, integrations, result = install_credentials
        credentials = (credential, peer, integrations, result)
        if any(
            not isinstance(secret, str) or not secret.isascii() or len(secret) < 32
            for secret in credentials
        ) or len(set(credentials)) != len(credentials):
            raise ValueError("Creative 安装和身份凭据必须独立")
        settings = database.sessions.kw["info"]["creative_file_settings"]
        packer = SkillArchivePacker(
            root=database.root,
            max_files=settings.fpl_skill_max_files,
            max_expanded_bytes=settings.fpl_skill_expanded_max_bytes,
            max_archive_bytes=settings.fpl_skill_archive_max_bytes,
        )
        outbox = InstallationOutbox(database, skill_root=database.root)
        authorization = IdentityInstallAuthorization(public_key=public_key, identity=identity)
        target = HttpCreativeInstallTarget(
            creative_peer_credential=peer,
            result_credential=result,
            transport=transport,
            archives=CreativeSkillArchives(database, packer),
        )
        app.state.skill_packer = packer
        app.state.installation_coordinator = InstallationCoordinator(outbox, authorization, target)
        app.state.creative_install_decisions = InstallDecisionEndpoint(
            peer_credential=integrations, authority=InstallGrantAuthority(outbox, authorization)
        )
        app.include_router(decision_router)
        app.include_router(installation_router, tags=["creative-workshop"])
        app.add_middleware(RequestLimit, prefix=INSTALL_PATH, maximum=MAX_BODY)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_middleware(SignedIdentity, service="creative", public_key=public_key, catalog=catalog)
    if web_root is not None:
        from fpl_runtime.protocol_hash import public_contract
        from fpl_runtime.web import attach_web, load_release

        public = json.loads(schema_path.read_text())
        actual = app.openapi()
        for path, operations in actual["paths"].items():
            if path.startswith("/v1/") and operations != public["paths"].get(path):
                raise ValueError("Creative 已接入接口与公开契约不匹配")
        release = load_release(web_root, "creative")
        if release.api_sha256 != public_contract(public, "creative", catalog):
            raise ValueError("Creative 页面与公开契约不匹配")
        attach_web(app, release, pages=("/creative-workshop", "/creative-workshop/"))

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "creative"}

    @app.get("/ready")
    async def ready():
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        # Source import, installation preview/setup, and migration are still gated.
        raise HTTPException(503, "creative_assembly_incomplete")

    return app
