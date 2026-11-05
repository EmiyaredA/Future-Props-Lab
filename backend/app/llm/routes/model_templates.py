from fastapi import APIRouter, Request

from app.console.governance.model_template_sync import (
    job_view,
    preview_sync,
    recent_jobs,
    start_sync,
)
from app.console.governance.model_templates import get_template, save_template
from app.console.routes.auth import _platform_auth
from studio.assembly.http_dependencies import SessionDep, client_ip
from studio.contracts.model_service.schemas.model_templates import (
    PlatformRole,
    RoleModelTemplateIn,
    RoleModelTemplateOut,
    TemplatePreviewIn,
    TemplateSyncIn,
    TemplateSyncJobOut,
)

router = APIRouter(prefix="/platform/model-service-templates", tags=["model-service-templates"])


@router.get("/{role}", response_model=RoleModelTemplateOut)
async def template(role: PlatformRole, request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await get_template(session, role)


@router.put("/{role}", response_model=RoleModelTemplateOut)
async def put_template(
    role: PlatformRole, request: Request, session: SessionDep, body: RoleModelTemplateIn
):
    principal = await _platform_auth(request, session)
    return await save_template(session, principal, role, body, client_ip(request))


@router.post("/{role}/preview", response_model=TemplateSyncJobOut, status_code=201)
async def preview(
    role: PlatformRole, request: Request, session: SessionDep, body: TemplatePreviewIn
):
    principal = await _platform_auth(request, session)
    return await preview_sync(
        session,
        principal,
        role,
        body.expected_template_revision,
        client_ip(request),
        account_ids=body.account_ids,
        sessions=request.app.state.database.sessions,
    )


@router.get("/sync-jobs/{job_id}", response_model=TemplateSyncJobOut)
async def job(job_id: str, request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await job_view(session, job_id)


@router.post("/sync-jobs/{job_id}/start", response_model=TemplateSyncJobOut)
async def start(job_id: str, request: Request, session: SessionDep, body: TemplateSyncIn):
    principal = await _platform_auth(request, session)
    return await start_sync(session, principal, job_id, body.expected_revision, client_ip(request))


@router.get("/{role}/sync-jobs", response_model=list[TemplateSyncJobOut])
async def history(role: PlatformRole, request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await recent_jobs(session, role)
