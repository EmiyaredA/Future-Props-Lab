"""Interview's signed browser API, account files and private room state."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.apps.interview_assistant.models import (
    InterviewMaterial,
    InterviewPreparation,
    InterviewRoom,
)
from app.apps.interview_assistant.rooms import ACTIVE
from app.apps.interview_assistant.routes import router
from app.apps.interview_assistant.schemas import InterviewExecutorOut
from app.deps import require_studio_auth
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.project_operations import ProjectOperationReceipt
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.web import attach_web, load_release

from .migrations.registry import MIGRATIONS

PAGES = ("/apps/interview-assistant", "/apps/interview-assistant/")
MODELS = (InterviewRoom, InterviewMaterial, InterviewPreparation, ProjectOperationReceipt)


async def worker_unavailable(_user_id, _owner, _session):
    return InterviewExecutorOut(
        available=False, code="executor_unavailable", message="本机面试资料执行器不可用", version=""
    )


async def recover(sessions):
    async with sessions(info={"allow_system_reads": True}) as db:
        owners = set(
            await db.scalars(
                select(InterviewPreparation.owner_user_id)
                .where(InterviewPreparation.status.in_(ACTIVE))
                .distinct()
            )
        )
    for owner in owners:
        async with sessions(info={"owner_user_id": owner}) as db:
            await db.execute(
                update(InterviewPreparation)
                .where(InterviewPreparation.status.in_(ACTIVE))
                .values(
                    status="interrupted",
                    message="应用已重启，准备任务中断；请手动重试",
                    revision=InterviewPreparation.revision + 1,
                    updated_at=utc_now(),
                )
            )
            await db.commit()


def create_app(*, state_root, catalog, public_key, schema_path=None, web_root=None):
    database = Database("interview", state_root, models=MODELS)
    database.sessions.configure(
        info={
            **database.sessions.kw["info"],
            "interview_files_root": database.root,
            "interview_executor_status": worker_unavailable,
        }
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "interview", MIGRATIONS)
                await recover(database.sessions)
                yield
            finally:
                await database.close()

    app = FastAPI(
        title="FPL Interview", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.add_middleware(SignedIdentity, service="interview", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.include_router(router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    if schema_path is not None:
        expected = public_contract(json.loads(schema_path.read_text()), "interview", catalog)
        if public_contract(app.openapi(), "interview", catalog) != expected:
            raise ValueError("面试助手公开接口与发布契约不匹配")
    if web_root is not None:
        release = load_release(web_root, "interview")
        if schema_path is None or release.api_sha256 != expected:
            raise ValueError("面试助手浏览器程序与发布契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "interview"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "interview_cutover_incomplete")

    return app
