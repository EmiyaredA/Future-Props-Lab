"""Independent Creative catalog backed by its own database and Identity peer."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.routes.creative_workshop import catalog_router
from app.deps import db_session
from studio.apps.creative_workshop.authors import HttpCreativeAuthors
from studio.apps.creative_workshop.install_authorization import IdentityInstallAuthorization
from studio.apps.creative_workshop.install_grants import InstallGrantAuthority
from studio.apps.creative_workshop.install_target import HttpCreativeInstallTarget
from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator
from studio.apps.creative_workshop.installation_outbox import InstallationOutbox
from studio.apps.creative_workshop.skill_archive import CreativeSkillArchives, SkillArchivePacker
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.creative_workshop.transport.certification_http import (
    router as certification_router,
)
from studio.apps.creative_workshop.transport.decision_http import InstallDecisionEndpoint
from studio.apps.creative_workshop.transport.decision_http import router as decision_router
from studio.apps.creative_workshop.transport.installation_http import router as installation_router
from studio.apps.creative_workshop.transport.preview_http import router as preview_router
from studio.apps.creative_workshop.transport.source_http import router as source_router
from studio.apps.creative_workshop.transport.stdio_http import router as stdio_router
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.identity.clients.certification import CertificationClient
from studio.contracts.creative_workshop.creative_install_evidence import INSTALL_PATH, MAX_BODY
from studio.contracts.creative_workshop.creative_source_evidence import SOURCE_PATH
from studio.contracts.creative_workshop.creative_stdio import PUBLIC_STDIO
from studio.runtime.database.migrations import check
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.problem_details import http_exception_handler, validation_exception_handler
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.lifecycle.locking import service_lock


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
    capabilities = CapabilityClient(
        service="creative", credential=credential, catalog=catalog, transport=transport
    )

    certifications = CertificationClient(
        credential=credential, public_key=public_key, transport=transport
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "creative", MIGRATIONS)
                yield
            finally:
                await certifications.close()
                await identity.close()
                await capabilities.close()
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
    app.state.identity, app.state.identity_public_key = identity, public_key
    app.state.creative_capabilities = capabilities
    app.state.certifications = certifications

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
    app.include_router(source_router, tags=["creative-workshop"])
    app.include_router(certification_router)
    app.add_middleware(RequestLimit, prefix=SOURCE_PATH, maximum=MAX_BODY)
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
        app.include_router(preview_router, tags=["creative-workshop"])
        app.include_router(stdio_router, tags=["creative-workshop"])
        app.add_middleware(RequestLimit, prefix=INSTALL_PATH, maximum=MAX_BODY, exact=True)
        app.add_middleware(RequestLimit, prefix=INSTALL_PATH + "/", maximum=256 * 1024)

    async def validate_request(request, exc):
        if getattr(request.scope.get("route"), "path", None) == PUBLIC_STDIO:
            return await http_exception_handler(
                request, HTTPException(422, "creative_stdio_configuration_invalid")
            )
        return await validation_exception_handler(request, exc)

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validate_request)
    app.add_middleware(SignedIdentity, service="creative", public_key=public_key, catalog=catalog)
    if web_root is not None:
        from studio.contracts.gateway.protocol_hash import public_contract
        from studio.runtime.http.web import attach_web, load_release

        public = json.loads(schema_path.read_text())
        actual = app.openapi()
        expected_routes = {
            (entry.method, entry.path)
            for entry in catalog.operations
            if entry.service == "creative"
        }
        actual_routes = {
            (method.upper(), path)
            for path, operations in actual["paths"].items()
            if path.startswith("/v1/")
            for method in operations
        }
        if actual_routes != expected_routes or public_contract(
            actual, "creative", catalog
        ) != public_contract(public, "creative", catalog):
            raise ValueError("Creative 公开接口与发布契约不匹配")
        release = load_release(web_root, "creative")
        if release.api_sha256 != public_contract(public, "creative", catalog):
            raise ValueError("Creative 页面与公开契约不匹配")
        attach_web(
            app,
            release,
            pages=tuple(
                "/creative-workshop" + page + trailing
                for page in ("", "/mine", "/new", "/edit/{item_id}", "/item/{item_id}")
                for trailing in ("", "/")
            ),
        )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "creative"}

    @app.get("/ready")
    async def ready():
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        # The owner applications and historical cutover are still gated.
        raise HTTPException(503, "creative_assembly_incomplete")

    return app
