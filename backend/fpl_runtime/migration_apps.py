"""Transport for explicitly started, loopback-only service maintenance processes."""

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import URL
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.problem_details import http_exception_handler, problem, storage_operational_error_handler

from .database import Database
from .locking import service_lock
from .migration_batches import BatchReceipt, MigrationAdmission
from .migrations import check
from .request_limit import RequestLimit

PREFIX = "/v1/migration"


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


def maintenance_app(plan, lifespan):
    admission = MigrationAdmission(plan)
    app = FastAPI(
        title="FPL migration maintenance",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(RequestLimit, prefix=PREFIX, maximum=2 * 1024 * 1024)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, _error):
        # Migration records can contain credential digests and encrypted settings.
        return problem(request, 422, "迁移请求格式无效", code="migration_request_invalid")

    @app.middleware("http")
    async def private(request, call_next):
        try:
            admission.authorize(request)
        except HTTPException as exc:
            response = await http_exception_handler(request, exc)
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    return app


def export_app(plan, path):
    source = SourceSnapshot(path, plan.source_database_sha256)
    engine = create_async_engine(
        URL.create(
            "sqlite+aiosqlite",
            database=source.path.as_uri(),
            query={"mode": "ro", "immutable": "1", "uri": "true"},
        ),
        hide_parameters=True,
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(_app):
        try:
            source.check()
            yield
        finally:
            await engine.dispose()

    return maintenance_app(plan, lifespan), sessions, source


def import_app(plan, state_root, service, models, migrations, *, account_models=None):
    database = Database(
        service, state_root, models=models, account_models=account_models, hide_parameters=True
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, service, migrations)
                yield
            finally:
                await database.close()

    return maintenance_app(plan, lifespan), database


def mount_dataset(
    app,
    *,
    prefix,
    plan,
    cursor_pattern,
    batch_model,
    page_model,
    inventory,
    page,
    ingest=None,
    source=None,
    platform=False,
):
    admission = MigrationAdmission(plan, platform=platform)

    def assert_source():
        if source is not None:
            try:
                source.check()
            except (ValueError, OSError) as exc:
                raise HTTPException(409, {"code": "migration_source_changed"}) from exc

    @app.get(f"{prefix}/inventory")
    async def read_inventory():
        assert_source()
        result = await inventory()
        assert_source()
        return result

    @app.get(f"{prefix}/{{owner_id}}", response_model=page_model)
    async def read_page(
        owner_id: UUID, after: Annotated[str | None, Query(pattern=cursor_pattern)] = None
    ):
        admission.check_owner(owner_id)
        assert_source()
        result = await page(owner_id, after)
        assert_source()
        return result

    if ingest is not None:

        @app.post(f"{prefix}/batches", response_model=BatchReceipt)
        async def import_batch(request: Request, batch: batch_model):
            admission.check_batch(request, batch)
            return await ingest(batch)
