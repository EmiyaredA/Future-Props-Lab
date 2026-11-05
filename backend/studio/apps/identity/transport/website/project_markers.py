"""Account-scoped certification through an explicitly bound project registry."""

from typing import Literal

from fastapi import APIRouter, Request

from studio.apps.identity.project_markers import certify_project
from studio.apps.identity.transport.website.auth import _browser_auth
from studio.assembly.http_dependencies import SessionDep, client_ip
from studio.contracts.identity.project_markers import CertificationIn, CertificationOut

router = APIRouter(tags=["platform-governance"])


@router.patch("/account/project-certification/{kind}/{project_id}", response_model=CertificationOut)
async def certification(
    kind: Literal["visual", "galgame"],
    project_id: str,
    request: Request,
    session: SessionDep,
    body: CertificationIn,
):
    principal = await _browser_auth(request, session)
    return await certify_project(
        session,
        principal,
        kind,
        project_id,
        body,
        client_ip(request),
        project_models=request.app.state.certifiable_projects,
    )
