"""Mount an owner-side certification slice on an independent project service."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.problem_details import http_exception_handler

from .certification_client import CertificationClient
from .certification_http import router
from .certification_owner import ProjectCertifications
from .database import Database
from .locking import service_lock
from .migrations import check
from .project_certification import MAX_BODY, PREFIX
from .request_limit import RequestLimit


def create_certification_app(
    *,
    service,
    root,
    models,
    migrations,
    project,
    receipts,
    key,
    credential,
    transport,
    run_worker,
):
    if not isinstance(credential, str) or len(credential) < 32:
        raise ValueError("作品服务需要专属身份凭据")
    database = Database(service, root, models=models)
    client = CertificationClient(credential=credential, public_key=key, transport=transport)
    certification = ProjectCertifications(
        service=service, database=database, project=project, receipts=receipts, client=client
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, service, migrations)
                if run_worker:
                    await certification.start()
                yield
            finally:
                await certification.stop()
                await client.close()
                await database.close()

    app = FastAPI(
        title="FPL " + service,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.identity_public_key = key
    app.state.project_certifications = certification
    app.state.database = database
    app.add_middleware(RequestLimit, prefix=PREFIX, maximum=MAX_BODY)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.include_router(router)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": service}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "project_application_assembly_incomplete")

    return app
