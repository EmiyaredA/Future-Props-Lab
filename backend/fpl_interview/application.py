"""Interview's signed browser API, account files and private room state."""

import asyncio
import json
from contextlib import asynccontextmanager, suppress

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
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.native_ingress import NativeIngress
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.request_limit import RequestLimit
from fpl_runtime.web import attach_web, load_release

from .host import InterviewHost
from .migrations.registry import MIGRATIONS
from .models import InterviewNativeLease
from .native_http import router as native_router

PAGES = ("/apps/interview-assistant", "/apps/interview-assistant/")
MODELS = (
    InterviewRoom,
    InterviewMaterial,
    InterviewPreparation,
    ProjectOperationReceipt,
    InterviewNativeLease,
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


async def expire_leases(host):
    while True:
        await asyncio.sleep(5)
        await host.expire()


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    schema_path=None,
    web_root=None,
    options=None,
    transport=None,
):
    database = Database("interview", state_root, models=MODELS, hide_parameters=True)
    identity = (
        LiveAuthorization(
            service="interview", credential=options.identity_credential, transport=transport
        )
        if options is not None
        else None
    )
    host = InterviewHost(database, identity)
    database.sessions.configure(
        info={
            **database.sessions.kw["info"],
            "interview_files_root": database.root,
            "interview_executor_status": host.status,
        }
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "interview", MIGRATIONS)
                await recover(database.sessions)
                expiry = asyncio.create_task(expire_leases(host))
                try:
                    yield
                finally:
                    expiry.cancel()
                    with suppress(asyncio.CancelledError):
                        await expiry
            finally:
                if identity is not None:
                    await identity.close()
                await database.close()

    app = FastAPI(
        title="FPL Interview", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.interview_host = host
    app.add_middleware(RequestLimit, prefix="/_native/", maximum=3 * 1024 * 1024)
    app.add_middleware(NativeIngress, options=options, state_key="interview_worker")
    app.add_middleware(SignedIdentity, service="interview", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.include_router(router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    app.include_router(native_router)
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
