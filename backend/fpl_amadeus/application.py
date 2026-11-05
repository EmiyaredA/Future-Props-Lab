"""Amadeus-owned records, lifecycle recovery and verified account requests."""

from contextlib import asynccontextmanager
from weakref import WeakValueDictionary

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.amadeus.models import AmadeusRun
from app.console.amadeus.run_records import ACTIVE
from app.console.amadeus.run_recovery import recover_runs
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.operation_receipts import OperationError
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check

from .file_http import router as file_router
from .migrations.registry import MIGRATIONS
from .models import MODELS
from .operation_http import router as operation_router
from .record_http import router
from .request_limits import AmadeusRequestLimits
from .skill_http import router as skill_router


async def recover(database):
    async with database.sessions(info={"allow_system_reads": True}) as db:
        owners = set(
            await db.scalars(
                select(AmadeusRun.owner_user_id).where(AmadeusRun.status.in_(ACTIVE)).distinct()
            )
        )
    for owner in owners:
        async with database.sessions(info={"owner_user_id": owner}) as db:
            await recover_runs(db)


def create_app(*, state_root, catalog, public_key, credential, transport=None):
    if not isinstance(credential, str) or len(credential) < 32:
        raise ValueError("Amadeus 需要专属身份凭据")
    capabilities = CapabilityClient(
        service="amadeus", credential=credential, catalog=catalog, transport=transport
    )
    database = Database("amadeus", state_root, models=MODELS, hide_parameters=True)

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "amadeus", MIGRATIONS)
                await recover(database)
                yield
            finally:
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Amadeus", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.capabilities = capabilities
    app.state.file_locks = WeakValueDictionary()
    app.include_router(router)
    app.include_router(file_router)
    app.include_router(operation_router)
    app.include_router(skill_router)
    app.add_middleware(AmadeusRequestLimits)
    app.add_middleware(SignedIdentity, service="amadeus", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)

    @app.exception_handler(OperationError)
    async def operation_error(request: Request, exc: OperationError):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "amadeus"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "amadeus_execution_assembly_incomplete")

    return app
