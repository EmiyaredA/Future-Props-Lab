"""Explicit loopback-only navigation maintenance applications."""

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import URL
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.problem_details import http_exception_handler, validation_exception_handler
from app.tool_navigation.models import ToolNavigationItem
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migration_batches import BatchReceipt, MigrationAdmission
from fpl_runtime.migrations import check
from fpl_runtime.request_limit import RequestLimit

from .migrations.registry import MIGRATIONS
from .models import ToolsNavigationImportReceipt
from .navigation_migration import (
    DATASET,
    TOOL_ID,
    NavigationBatch,
    NavigationPage,
    export_page,
    import_batch,
    navigation_inventory,
)

PREFIX = "/v1/migration/tools/navigation"
reads = APIRouter(prefix=PREFIX)
writes = APIRouter(prefix=PREFIX)


class SourceSnapshot:
    def __init__(self, path: Path, expected_digest: str):
        if path.is_symlink() or not path.is_file():
            raise ValueError("迁移源必须是显式选择的数据库快照")
        self.path = path.resolve()
        self.initial = self._signature()
        with self.path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != expected_digest:
            raise ValueError("迁移源数据库摘要与计划不匹配")
        self.check()

    def _signature(self):
        wal = self.path.with_name(self.path.name + "-wal")
        if wal.is_symlink() or (wal.exists() and wal.stat().st_size):
            raise ValueError("迁移源必须停止写入并完成 WAL 检查点")
        info = self.path.stat()
        return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns

    def check(self):
        if self._signature() != self.initial:
            raise ValueError("迁移源数据库快照在导出期间发生变化")


def _assert_source(request):
    source = request.app.state.migration_source
    if source is not None:
        try:
            source.check()
        except (ValueError, OSError) as exc:
            raise HTTPException(409, {"code": "migration_source_changed"}) from exc


@reads.get("/inventory")
async def inventory(request: Request):
    admission = request.app.state.migration_admission
    admission.authorize(request)
    _assert_source(request)
    result = await navigation_inventory(
        request.app.state.migration_sessions,
        admission.plan.owner_ids,
        system=request.app.state.migration_source is None,
    )
    _assert_source(request)
    return result


@reads.get("/{owner_id}", response_model=NavigationPage)
async def export_navigation(
    request: Request,
    owner_id: UUID,
    after: Annotated[str | None, Query(pattern=TOOL_ID)] = None,
):
    admission = request.app.state.migration_admission
    admission.check(request, owner_id)
    _assert_source(request)
    page = await export_page(request.app.state.migration_sessions, admission.plan, owner_id, after)
    _assert_source(request)
    return page


@writes.post("/batches", response_model=BatchReceipt)
async def import_navigation(request: Request, batch: NavigationBatch):
    request.app.state.migration_admission.check_batch(request, batch)
    return await import_batch(request.app.state.migration_database, batch)


def _app(plan, sessions, lifespan, *, source=None):
    app = FastAPI(
        title=f"FPL {DATASET} maintenance",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.migration_admission = MigrationAdmission(plan)
    app.state.migration_source = source
    app.state.migration_sessions = sessions
    app.add_middleware(RequestLimit, prefix=PREFIX, maximum=256 * 1024)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    @app.middleware("http")
    async def private(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    app.include_router(reads)
    return app


def create_export_app(*, plan, source_path):
    source = SourceSnapshot(source_path, plan.source_database_sha256)
    engine = create_async_engine(
        URL.create(
            "sqlite+aiosqlite",
            database=source.path.as_uri(),
            query={"mode": "ro", "immutable": "1", "uri": "true"},
        )
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(_app):
        try:
            source.check()
            yield
        finally:
            await engine.dispose()

    return _app(plan, sessions, lifespan, source=source)


def create_import_app(*, plan, state_root):
    database = Database(
        "tools", state_root, models=(ToolNavigationItem, ToolsNavigationImportReceipt)
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "tools", MIGRATIONS)
                yield
            finally:
                await database.close()

    app = _app(plan, database.sessions, lifespan)
    app.state.migration_database = database
    app.include_router(writes)
    return app
