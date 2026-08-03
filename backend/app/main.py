from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.routes import api_router
from db.migrations import apply_migrations

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    apply_migrations(settings.database_path)
    try:
        yield
    finally:
        await engine.dispose()


app = FastAPI(
    title="Future Props Lab API",
    version="0.1.0",
    description="未来道具研究所模型目录与调用观测 API",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
app.add_exception_handler(OperationalError, storage_operational_error_handler)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1 FROM schema_migrations LIMIT 1"))
        await session.execute(text("SELECT 1 FROM model_catalog_state WHERE id = 'default'"))
    return {"status": "ready", "schema": "r0001_initial"}
