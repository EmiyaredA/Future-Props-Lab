from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.console.governance.service import AccountError
from db.migrations.registry import LATEST_MIGRATION_ID
from studio.assembly.website.routes import api_router
from studio.runtime.http.problem_details import (
    account_exception_handler,
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.revisions import RevisionConflictError


def create_http_app(*, lifespan_context=None):
    app = FastAPI(
        title="Future Props Lab API",
        version="0.1.0",
        description="未来道具研究所模型目录与调用观测 API",
        lifespan=lifespan_context,
    )
    app.include_router(api_router)

    app.add_exception_handler(AccountError, account_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready(request: Request) -> dict[str, str]:
        app = request.app
        if getattr(app.state, "storage_upgrade_required", False):
            raise StarletteHTTPException(
                status_code=503,
                detail={
                    "code": "account_storage_upgrade_required",
                    "message": "account storage upgrade requires restart",
                },
            )
        async with app.state.database.sessions() as session:
            await session.execute(text("SELECT 1 FROM schema_migrations LIMIT 1"))
            await session.execute(text("SELECT 1 FROM users LIMIT 1"))
        supervisor = getattr(app.state, "runner_supervisor", None)
        if supervisor is not None and not supervisor.is_healthy:
            raise StarletteHTTPException(status_code=503, detail="background runners are not ready")
        return {"status": "ready", "schema": LATEST_MIGRATION_ID}

    return app
