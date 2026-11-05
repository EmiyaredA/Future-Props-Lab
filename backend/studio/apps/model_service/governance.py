"""HTTP checks and protocol mapping for Models-owned platform policies."""

from fastapi import APIRouter, Request

from app.deps import SessionDep
from app.llm.schemas.model_templates import (
    PlatformRole,
    RoleModelTemplateIn,
    RoleModelTemplateOut,
    TemplatePreviewIn,
    TemplateSyncIn,
    TemplateSyncJobOut,
)
from app.llm.schemas.runtime_quotas import RuntimeQuotasIn, RuntimeQuotasOut
from studio.apps.model_service.admission.quotas import QuotaPolicies
from studio.apps.model_service.audit.audit import request_audits
from studio.apps.model_service.transport.http_auth import browser

from .policy_changes import save_quotas, save_template
from .template_sync import job_view
from .templates import RoleTemplates

router = APIRouter()


@router.get(
    "/platform/runtime-quotas", response_model=RuntimeQuotasOut, tags=["platform-governance"]
)
async def get_quotas(request: Request, session: SessionDep):
    await browser(request, session, admin=True)
    return await QuotaPolicies(session).read()


@router.patch(
    "/platform/runtime-quotas", response_model=RuntimeQuotasOut, tags=["platform-governance"]
)
async def patch_quotas(request: Request, session: SessionDep, body: RuntimeQuotasIn):
    principal = await browser(request, session, admin=True)
    return await save_quotas(session, principal, body, request_audits(request))


@router.get(
    "/platform/model-service-templates/{role}",
    response_model=RoleModelTemplateOut,
    tags=["model-service-templates"],
)
async def template(role: PlatformRole, request: Request, session: SessionDep):
    await browser(request, session, admin=True)
    return await RoleTemplates(session).view(role)


@router.put(
    "/platform/model-service-templates/{role}",
    response_model=RoleModelTemplateOut,
    tags=["model-service-templates"],
)
async def put_template(
    role: PlatformRole, request: Request, session: SessionDep, body: RoleModelTemplateIn
):
    principal = await browser(request, session, admin=True)
    return await save_template(session, principal, role, body, request_audits(request))


@router.post(
    "/platform/model-service-templates/{role}/preview",
    response_model=TemplateSyncJobOut,
    tags=["model-service-templates"],
    status_code=201,
)
async def preview(
    role: PlatformRole, request: Request, session: SessionDep, body: TemplatePreviewIn
):
    principal = await browser(request, session, admin=True)
    return await request.app.state.template_sync.preview(
        request, session, principal, role, body, audits=request_audits(request)
    )


@router.get(
    "/platform/model-service-templates/sync-jobs/{job_id}",
    response_model=TemplateSyncJobOut,
    tags=["model-service-templates"],
)
async def job(job_id: str, request: Request, session: SessionDep):
    await browser(request, session, admin=True)
    return await job_view(session, job_id)


@router.post(
    "/platform/model-service-templates/sync-jobs/{job_id}/start",
    response_model=TemplateSyncJobOut,
    tags=["model-service-templates"],
)
async def start(job_id: str, request: Request, session: SessionDep, body: TemplateSyncIn):
    principal = await browser(request, session, admin=True)
    return await request.app.state.template_sync.start_job(
        request, session, principal, job_id, body.expected_revision, audits=request_audits(request)
    )


@router.get(
    "/platform/model-service-templates/{role}/sync-jobs",
    response_model=list[TemplateSyncJobOut],
    tags=["model-service-templates"],
)
async def history(role: PlatformRole, request: Request, session: SessionDep):
    await browser(request, session, admin=True)
    return await request.app.state.template_sync.recent(session, role)
