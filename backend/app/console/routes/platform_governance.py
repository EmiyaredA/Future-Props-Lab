"""Protocol boundary for platform policy and registration governance."""

from typing import Literal

from fastapi import APIRouter, Request, Response

from app.console.governance.developer_docs import developer_documents
from app.console.governance.platform_settings import write_setting
from app.console.governance.settings_records import read_setting
from app.console.schemas.developer_documents import DeveloperDocumentsOut
from studio.apps.identity.transport.website.auth import _browser_auth, _platform_auth
from studio.assembly.http_dependencies import SessionDep, client_ip
from studio.contracts.identity.project_markers import CertificationIn, CertificationOut
from studio.contracts.model_service.schemas.runtime_quotas import (
    RuntimeQuotas,
    RuntimeQuotasIn,
    RuntimeQuotasOut,
)

router = APIRouter(tags=["platform-governance"])


@router.get("/platform/runtime-quotas", response_model=RuntimeQuotasOut)
async def get_quotas(request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await read_setting(session, "runtime_quotas", RuntimeQuotas().model_dump())


@router.patch("/platform/runtime-quotas", response_model=RuntimeQuotasOut)
async def patch_quotas(request: Request, session: SessionDep, body: RuntimeQuotasIn):
    principal = await _platform_auth(request, session)
    return await write_setting(
        session,
        principal,
        "runtime_quotas",
        body.value.model_dump(),
        body.expected_revision,
        client_ip(request),
    )


@router.get("/account/developer-documents", response_model=DeveloperDocumentsOut)
async def developer_docs(request: Request, response: Response, session: SessionDep):
    principal = await _browser_auth(request, session)
    response.headers["Cache-Control"] = "no-store"
    return developer_documents(principal)


@router.patch("/account/project-certification/{kind}/{project_id}", response_model=CertificationOut)
async def certification(
    kind: Literal["visual", "galgame"],
    project_id: str,
    request: Request,
    session: SessionDep,
    body: CertificationIn,
):
    from app.console.governance.project_certification import certify_project

    principal = await _browser_auth(request, session)
    return await certify_project(session, principal, kind, project_id, body, client_ip(request))
